import { randomBytes } from 'node:crypto';
import { createDatabase, createPool } from '@gp/db';
import { users } from '@gp/db/schema';
import { eq } from 'drizzle-orm';
import { afterAll } from 'vitest';
import { login, signUp, validateSession, verifyEmail } from '../identity/auth';
import { MemoryMailer } from '../identity/mailer';
import { beginTotpEnrollment, confirmTotpEnrollment } from '../identity/totp';
import { Secret, TOTP } from 'otpauth';
import type { CoreContext } from '../shared/context';
import { MemoryStorage } from '../storage/storage';

/**
 * Integration-test support. Tests run against the migrated database in DATABASE_URL and
 * isolate themselves with unique emails and ids instead of truncating tables, so they can run
 * in parallel and against a database that already holds data.
 */
export const databaseUrl = process.env.DATABASE_URL;

export interface TestContext extends CoreContext {
  mailer: MemoryMailer;
  storage: MemoryStorage;
  clock: { now: Date };
}

export function createTestContext(start = new Date('2030-01-01T09:00:00Z')): TestContext {
  const pool = createPool(databaseUrl!, 5);
  afterAll(() => pool.end());
  const clock = { now: start };
  return {
    db: createDatabase(pool),
    mailer: new MemoryMailer(),
    storage: new MemoryStorage(),
    encryptionKey: randomBytes(32),
    appBaseUrl: 'http://localhost:3000',
    now: () => clock.now,
    clock,
  };
}

export function advance(ctx: TestContext, minutes: number): Date {
  ctx.clock.now = new Date(ctx.clock.now.getTime() + minutes * 60_000);
  return ctx.clock.now;
}

export function uniqueEmail(prefix = 'owner'): string {
  return `${prefix}-${randomBytes(6).toString('hex')}@example.test`;
}

export const PASSWORD = 'correct horse battery';

/** Signs up a user with a verified email and returns their id, workspace and session token. */
export async function createOwner(ctx: TestContext, opts: { verified?: boolean } = {}) {
  const email = uniqueEmail();
  const { userId, workspaceId, session } = await signUp(
    ctx,
    { email, password: PASSWORD, fullName: 'مالك المناسبة' },
    { ip: `ip-${randomBytes(4).toString('hex')}` },
  );
  if (opts.verified !== false) {
    const link = ctx.mailer.lastLink('email_verification', email)!;
    await verifyEmail(ctx, new URL(link).searchParams.get('token')!);
  }
  return { userId, workspaceId, email, token: session.token };
}

export async function createAdmin(ctx: TestContext) {
  const owner = await createOwner(ctx);
  await ctx.db.update(users).set({ platformRole: 'admin' }).where(eq(users.id, owner.userId));
  const { session } = await login(ctx, { email: owner.email, password: PASSWORD });
  return { ...owner, token: session.token };
}

/** An admin who enrolled TOTP; the returned principal has passed the second factor. */
export async function createVerifiedAdmin(ctx: TestContext) {
  const admin = await createAdmin(ctx);
  const p = await principalFor(ctx, admin.token);
  const { secret } = await beginTotpEnrollment(ctx, admin.userId);
  const code = new TOTP({ secret: Secret.fromBase32(secret) }).generate({
    timestamp: ctx.now().getTime(),
  });
  await confirmTotpEnrollment(ctx, admin.userId, p.session.id, code);
  return { ...admin, principal: await principalFor(ctx, admin.token) };
}

export async function principalFor(ctx: TestContext, token: string) {
  const p = await validateSession(ctx, token);
  if (!p) throw new Error('session invalid');
  return p;
}

/** A valid create-event form, starting `daysAhead` days after the test clock. */
export function eventInput(ctx: TestContext, overrides: Record<string, unknown> = {}) {
  const start = new Date(ctx.clock.now.getTime() + 7 * 86_400_000);
  const local = start.toISOString().slice(0, 10);
  return {
    category: 'private',
    type: 'wedding',
    name: 'حفل زفاف',
    startsAt: `${local}T20:00`,
    timezone: 'Asia/Riyadh',
    city: 'الرياض',
    venueName: 'قاعة الملك',
    defaultAllowedCompanions: '2',
    ...overrides,
  };
}
