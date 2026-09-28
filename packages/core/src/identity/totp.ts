import { users, userSessions } from '@gp/db/schema';
import { and, eq, isNull, or, lt } from 'drizzle-orm';
import { Secret, TOTP } from 'otpauth';
import type { CoreContext } from '../shared/context';
import { decrypt, encrypt } from '../shared/crypto';
import { DomainError } from '../shared/errors';
import { consumeRateLimit } from './rate-limit';

const ISSUER = 'Guest Platform';
const PERIOD_SECONDS = 30;

function totpFor(secretBase32: string, label: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    label,
    algorithm: 'SHA1',
    digits: 6,
    period: PERIOD_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  });
}

async function loadUser(ctx: CoreContext, userId: string) {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (!user || user.status !== 'active') throw new DomainError('unauthenticated');
  return user;
}

/**
 * Validates a code against the stored secret, allowing one step of clock drift, and records the
 * accepted step so the same code can't be used twice.
 */
async function checkCode(ctx: CoreContext, userId: string, secretBase32: string, code: string) {
  const now = ctx.now();
  await consumeRateLimit(ctx.db, `totp:user:${userId}`, 5, 300, now);
  const cleaned = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(cleaned)) throw new DomainError('invalid_totp_code');
  const delta = totpFor(secretBase32, '').validate({
    token: cleaned,
    timestamp: now.getTime(),
    window: 1,
  });
  if (delta === null) throw new DomainError('invalid_totp_code');
  const step = Math.floor(now.getTime() / 1000 / PERIOD_SECONDS) + delta;
  const updated = await ctx.db
    .update(users)
    .set({ totpLastStep: step })
    .where(and(eq(users.id, userId), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  if (updated.length === 0) throw new DomainError('invalid_totp_code', 'Code already used');
}

/**
 * Starts (or restarts) enrollment: stores a new encrypted secret and returns the otpauth URI
 * for the authenticator app. Only possible while TOTP is not yet enabled.
 */
export async function beginTotpEnrollment(ctx: CoreContext, userId: string) {
  const user = await loadUser(ctx, userId);
  if (user.totpEnabledAt) throw new DomainError('forbidden', 'TOTP already enabled');
  const secret = new Secret({ size: 20 });
  await ctx.db
    .update(users)
    .set({ totpSecretEnc: encrypt(secret.base32, ctx.encryptionKey), updatedAt: ctx.now() })
    .where(eq(users.id, userId));
  return {
    secret: secret.base32,
    uri: totpFor(secret.base32, user.email).toString(),
  };
}

/** Confirms enrollment with a first code; the current session counts as MFA-verified. */
export async function confirmTotpEnrollment(
  ctx: CoreContext,
  userId: string,
  sessionId: string,
  code: string,
): Promise<void> {
  const user = await loadUser(ctx, userId);
  if (user.totpEnabledAt || !user.totpSecretEnc) throw new DomainError('forbidden');
  await checkCode(ctx, userId, decrypt(user.totpSecretEnc, ctx.encryptionKey), code);
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    await tx.update(users).set({ totpEnabledAt: now, updatedAt: now }).where(eq(users.id, userId));
    await tx
      .update(userSessions)
      .set({ mfaVerifiedAt: now })
      .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)));
  });
}

/** Second factor at sign-in: marks the session MFA-verified. */
export async function verifyTotp(
  ctx: CoreContext,
  userId: string,
  sessionId: string,
  code: string,
): Promise<void> {
  const user = await loadUser(ctx, userId);
  if (!user.totpEnabledAt || !user.totpSecretEnc) throw new DomainError('forbidden');
  await checkCode(ctx, userId, decrypt(user.totpSecretEnc, ctx.encryptionKey), code);
  await ctx.db
    .update(userSessions)
    .set({ mfaVerifiedAt: ctx.now() })
    .where(and(eq(userSessions.id, sessionId), eq(userSessions.userId, userId)));
}
