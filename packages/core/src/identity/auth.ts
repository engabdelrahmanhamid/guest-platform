import { authTokens, users, userSessions } from '@gp/db/schema';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordActivity } from '../activity/activity';
import { createPersonalWorkspace } from '../workspaces/workspaces';
import type { CoreContext, DbOrTx } from '../shared/context';
import { randomToken, sha256 } from '../shared/crypto';
import { DomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import { parseInput } from '../shared/validation';
import { hashPassword, verifyAgainstDummy, verifyPassword } from './passwords';
import { consumeRateLimit } from './rate-limit';

const OWNER_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;
const EMAIL_VERIFICATION_TTL_MS = 48 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email({ message: 'invalid_email' }).max(254, { message: 'too_long' }));
const password = z
  .string()
  .min(10, { message: 'password_too_short' })
  .max(128, { message: 'too_long' });

export const signUpSchema = z.object({
  email,
  password,
  fullName: z.string().trim().min(1, { message: 'required' }).max(120, { message: 'too_long' }),
  locale: z.enum(['ar', 'en']).default('ar'),
});

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  locale: 'ar' | 'en';
  platformRole: 'none' | 'admin';
  emailVerified: boolean;
  totpEnabled: boolean;
}

export interface AuthSession {
  id: string;
  mfaVerified: boolean;
  expiresAt: Date;
}

export interface Principal {
  user: SessionUser;
  session: AuthSession;
}

interface Meta {
  ip?: string | undefined;
  userAgent?: string | undefined;
}

async function createSession(
  db: DbOrTx,
  user: { id: string; platformRole: 'none' | 'admin' },
  now: Date,
  meta: Meta,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const ttl = user.platformRole === 'admin' ? ADMIN_SESSION_TTL_MS : OWNER_SESSION_TTL_MS;
  const expiresAt = new Date(now.getTime() + ttl);
  await db.insert(userSessions).values({
    id: newId(),
    userId: user.id,
    tokenHash: sha256(token),
    createdAt: now,
    lastSeenAt: now,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
  return { token, expiresAt };
}

/** Rate-limit buckets hold a hash, not the owner's address. */
function emailKey(address: string): string {
  return sha256(address).toString('hex').slice(0, 32);
}

async function issueToken(
  db: DbOrTx,
  userId: string,
  purpose: 'email_verification' | 'password_reset',
  ttlMs: number,
  now: Date,
): Promise<string> {
  const token = randomToken();
  // One live link per purpose: asking again cancels the earlier ones, so a forgotten or
  // forwarded email can't be used after a newer request or a completed reset.
  await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
      ),
    );
  await db.insert(authTokens).values({
    id: newId(),
    userId,
    purpose,
    tokenHash: sha256(token),
    expiresAt: new Date(now.getTime() + ttlMs),
    createdAt: now,
  });
  return token;
}

/**
 * Creates the user, their hidden personal workspace and its owner membership in one
 * transaction, sends the verification email, and signs the user in.
 */
export async function signUp(ctx: CoreContext, input: unknown, meta: Meta = {}) {
  const data = parseInput(signUpSchema, input);
  const now = ctx.now();
  if (meta.ip) await consumeRateLimit(ctx.db, `signup:ip:${meta.ip}`, 10, 3600, now);

  const passwordHash = await hashPassword(data.password);
  const userId = newId();
  const result = await ctx.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(users)
      .values({
        id: userId,
        email: data.email,
        passwordHash,
        fullName: data.fullName,
        locale: data.locale,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: users.id });
    if (inserted.length === 0) throw new DomainError('email_taken');

    await recordActivity(tx, { type: 'user.registered', actor: { type: 'user', userId } });
    const workspaceId = await createPersonalWorkspace(
      tx,
      { id: userId, fullName: data.fullName },
      now,
    );
    const verificationToken = await issueToken(
      tx,
      userId,
      'email_verification',
      EMAIL_VERIFICATION_TTL_MS,
      now,
    );
    const session = await createSession(tx, { id: userId, platformRole: 'none' }, now, meta);
    return { workspaceId, verificationToken, session };
  });

  await ctx.mailer.sendEmailVerification(
    { email: data.email, name: data.fullName },
    `${ctx.appBaseUrl}/verify-email?token=${result.verificationToken}`,
  );
  return { userId, workspaceId: result.workspaceId, session: result.session };
}

export async function login(ctx: CoreContext, input: unknown, meta: Meta = {}) {
  const data = parseInput(loginSchema, input);
  const now = ctx.now();
  await consumeRateLimit(ctx.db, `login:email:${emailKey(data.email)}`, 10, 900, now);
  if (meta.ip) await consumeRateLimit(ctx.db, `login:ip:${meta.ip}`, 50, 900, now);

  const [user] = await ctx.db.select().from(users).where(eq(users.email, data.email));
  if (!user) {
    await verifyAgainstDummy(data.password);
    throw new DomainError('invalid_credentials');
  }
  if (!(await verifyPassword(user.passwordHash, data.password))) {
    throw new DomainError('invalid_credentials');
  }
  if (user.status !== 'active') throw new DomainError('user_disabled');

  await ctx.db.update(users).set({ lastLoginAt: now }).where(eq(users.id, user.id));
  const session = await createSession(ctx.db, user, now, meta);
  return { userId: user.id, session, mfaRequired: user.platformRole === 'admin' };
}

/**
 * Resolves a session cookie to the signed-in principal, or null. Disabled users, revoked and
 * expired sessions all resolve to null, so every request re-checks account status.
 */
export async function validateSession(ctx: CoreContext, token: string): Promise<Principal | null> {
  if (!token) return null;
  const now = ctx.now();
  const [row] = await ctx.db
    .select({ session: userSessions, user: users })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(
      and(
        eq(userSessions.tokenHash, sha256(token)),
        isNull(userSessions.revokedAt),
        gt(userSessions.expiresAt, now),
      ),
    );
  if (!row || row.user.status !== 'active') return null;

  if (now.getTime() - row.session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
    await ctx.db
      .update(userSessions)
      .set({ lastSeenAt: now })
      .where(eq(userSessions.id, row.session.id));
  }
  return {
    user: {
      id: row.user.id,
      email: row.user.email,
      fullName: row.user.fullName,
      locale: row.user.locale,
      platformRole: row.user.platformRole,
      emailVerified: row.user.emailVerifiedAt !== null,
      totpEnabled: row.user.totpEnabledAt !== null,
    },
    session: {
      id: row.session.id,
      mfaVerified: row.session.mfaVerifiedAt !== null,
      expiresAt: row.session.expiresAt,
    },
  };
}

export async function logout(ctx: CoreContext, token: string): Promise<void> {
  await ctx.db
    .update(userSessions)
    .set({ revokedAt: ctx.now() })
    .where(and(eq(userSessions.tokenHash, sha256(token)), isNull(userSessions.revokedAt)));
}

export async function revokeAllSessions(db: DbOrTx, userId: string, now: Date): Promise<void> {
  await db
    .update(userSessions)
    .set({ revokedAt: now })
    .where(and(eq(userSessions.userId, userId), isNull(userSessions.revokedAt)));
}

/** Marks a token used and returns its user id, or throws `invalid_token`. Single use. */
async function consumeToken(
  db: DbOrTx,
  token: string,
  purpose: 'email_verification' | 'password_reset',
  now: Date,
): Promise<string> {
  const [row] = await db
    .update(authTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(authTokens.tokenHash, sha256(token)),
        eq(authTokens.purpose, purpose),
        isNull(authTokens.usedAt),
        gt(authTokens.expiresAt, now),
      ),
    )
    .returning({ userId: authTokens.userId });
  if (!row) throw new DomainError('invalid_token');
  return row.userId;
}

export async function verifyEmail(ctx: CoreContext, token: string): Promise<void> {
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    const userId = await consumeToken(tx, token, 'email_verification', now);
    await tx
      .update(users)
      .set({ emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now})`, updatedAt: now })
      .where(eq(users.id, userId));
  });
}

export async function resendEmailVerification(ctx: CoreContext, userId: string): Promise<void> {
  const now = ctx.now();
  await consumeRateLimit(ctx.db, `verify:user:${userId}`, 5, 3600, now);
  const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
  if (!user || user.emailVerifiedAt) return;
  const token = await issueToken(
    ctx.db,
    userId,
    'email_verification',
    EMAIL_VERIFICATION_TTL_MS,
    now,
  );
  await ctx.mailer.sendEmailVerification(
    { email: user.email, name: user.fullName },
    `${ctx.appBaseUrl}/verify-email?token=${token}`,
  );
}

/** Always succeeds from the caller's point of view, so it can't be used to probe accounts. */
export async function requestPasswordReset(ctx: CoreContext, input: unknown, meta: Meta = {}) {
  const { email: address } = parseInput(z.object({ email }), input);
  const now = ctx.now();
  await consumeRateLimit(ctx.db, `reset:email:${emailKey(address)}`, 5, 3600, now);
  if (meta.ip) await consumeRateLimit(ctx.db, `reset:ip:${meta.ip}`, 20, 3600, now);
  const [user] = await ctx.db.select().from(users).where(eq(users.email, address));
  if (!user || user.status !== 'active') return;
  const token = await issueToken(ctx.db, user.id, 'password_reset', PASSWORD_RESET_TTL_MS, now);
  // Not awaited: sending takes far longer than the "no such account" path, and the difference
  // would tell a caller which addresses are registered. A failed send is the mailer's to log.
  void ctx.mailer
    .sendPasswordReset(
      { email: user.email, name: user.fullName },
      `${ctx.appBaseUrl}/reset-password?token=${token}`,
    )
    .catch(() => undefined);
}

/** Sets a new password and signs the user out everywhere. */
export async function resetPassword(ctx: CoreContext, input: unknown): Promise<void> {
  const data = parseInput(z.object({ token: z.string().min(1), password }), input);
  const now = ctx.now();
  const passwordHash = await hashPassword(data.password);
  await ctx.db.transaction(async (tx) => {
    const userId = await consumeToken(tx, data.token, 'password_reset', now);
    await tx.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId));
    await revokeAllSessions(tx, userId, now);
  });
}
