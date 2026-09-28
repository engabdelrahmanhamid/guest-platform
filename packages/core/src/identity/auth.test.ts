import { activity, eventMemberships, users, workspaceMembers, workspaces } from '@gp/db/schema';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setUserDisabled } from '../admin/admin';
import { isDomainError } from '../shared/errors';
import {
  createVerifiedAdmin,
  createOwner,
  createTestContext,
  databaseUrl,
  PASSWORD,
  uniqueEmail,
} from '../testing/harness';
import {
  login,
  logout,
  requestPasswordReset,
  resetPassword,
  signUp,
  validateSession,
  verifyEmail,
} from './auth';

describe.skipIf(!databaseUrl)('authentication', () => {
  const ctx = createTestContext();

  it('signs up: user, hidden personal workspace and owner membership in one go', async () => {
    const email = uniqueEmail();
    const res = await signUp(ctx, {
      email: ` ${email.toUpperCase()} `,
      password: PASSWORD,
      fullName: 'سارة',
    });

    const [user] = await ctx.db.select().from(users).where(eq(users.id, res.userId));
    expect(user?.email).toBe(email);
    expect(user?.emailVerifiedAt).toBeNull();
    const [ws] = await ctx.db.select().from(workspaces).where(eq(workspaces.id, res.workspaceId));
    expect(ws).toMatchObject({ kind: 'personal', createdByUserId: res.userId });
    const members = await ctx.db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, res.workspaceId));
    expect(members).toEqual([expect.objectContaining({ userId: res.userId, role: 'owner' })]);
    const types = await ctx.db
      .select({ type: activity.type })
      .from(activity)
      .where(eq(activity.actorUserId, res.userId));
    expect(types.map((t) => t.type).sort()).toEqual(['user.registered', 'workspace.created']);

    const principal = await validateSession(ctx, res.session.token);
    expect(principal?.user).toMatchObject({ id: res.userId, emailVerified: false });
  });

  it('rejects a duplicate email without creating a second workspace', async () => {
    const email = uniqueEmail();
    await signUp(ctx, { email, password: PASSWORD, fullName: 'أ' });
    await expect(signUp(ctx, { email, password: PASSWORD, fullName: 'ب' })).rejects.toSatisfy((e) =>
      isDomainError(e, 'email_taken'),
    );
    const count = await ctx.db
      .select()
      .from(workspaces)
      .innerJoin(users, eq(users.id, workspaces.createdByUserId))
      .where(eq(users.email, email));
    expect(count).toHaveLength(1);
  });

  it('returns field codes the UI translates', async () => {
    await expect(
      signUp(ctx, { email: 'not-an-email', password: 'short', fullName: '' }),
    ).rejects.toSatisfy(
      (e) =>
        isDomainError(e, 'validation_failed') &&
        JSON.stringify(e.details) ===
          JSON.stringify({
            fields: {
              email: 'invalid_email',
              password: 'password_too_short',
              fullName: 'required',
            },
          }),
    );
  });

  it('logs in with the right password only, and logout ends the session', async () => {
    const owner = await createOwner(ctx);
    await expect(login(ctx, { email: owner.email, password: 'wrong password!' })).rejects.toSatisfy(
      (e) => isDomainError(e, 'invalid_credentials'),
    );
    await expect(
      login(ctx, { email: uniqueEmail('nobody'), password: PASSWORD }),
    ).rejects.toSatisfy((e) => isDomainError(e, 'invalid_credentials'));

    const { session, mfaRequired } = await login(ctx, { email: owner.email, password: PASSWORD });
    expect(mfaRequired).toBe(false);
    expect(await validateSession(ctx, session.token)).not.toBeNull();
    await logout(ctx, session.token);
    expect(await validateSession(ctx, session.token)).toBeNull();
  });

  it('denies a disabled user: no login, and existing sessions stop working', async () => {
    const admin = await createVerifiedAdmin(ctx);
    const owner = await createOwner(ctx);
    await setUserDisabled(ctx, admin.principal, owner.userId, true, 'مخالفة');

    expect(await validateSession(ctx, owner.token)).toBeNull();
    await expect(login(ctx, { email: owner.email, password: PASSWORD })).rejects.toSatisfy((e) =>
      isDomainError(e, 'user_disabled'),
    );
  });

  it('verifies email once per token', async () => {
    const email = uniqueEmail();
    const { userId } = await signUp(ctx, { email, password: PASSWORD, fullName: 'ن' });
    const token = new URL(ctx.mailer.lastLink('email_verification', email)!).searchParams.get(
      'token',
    )!;
    await verifyEmail(ctx, token);
    const [user] = await ctx.db.select().from(users).where(eq(users.id, userId));
    expect(user?.emailVerifiedAt).not.toBeNull();
    await expect(verifyEmail(ctx, token)).rejects.toSatisfy((e) =>
      isDomainError(e, 'invalid_token'),
    );
  });

  it('resets a password and signs out every session', async () => {
    const owner = await createOwner(ctx);
    await requestPasswordReset(ctx, { email: owner.email });
    // Unknown emails succeed silently so accounts can't be probed.
    await requestPasswordReset(ctx, { email: uniqueEmail('ghost') });
    const token = new URL(ctx.mailer.lastLink('password_reset', owner.email)!).searchParams.get(
      'token',
    )!;

    await resetPassword(ctx, { token, password: 'a brand new password' });
    expect(await validateSession(ctx, owner.token)).toBeNull();
    await expect(login(ctx, { email: owner.email, password: PASSWORD })).rejects.toSatisfy((e) =>
      isDomainError(e, 'invalid_credentials'),
    );
    await login(ctx, { email: owner.email, password: 'a brand new password' });
    await expect(resetPassword(ctx, { token, password: 'another password!!' })).rejects.toSatisfy(
      (e) => isDomainError(e, 'invalid_token'),
    );
  });

  it('expires sessions', async () => {
    const owner = await createOwner(ctx);
    const saved = ctx.clock.now;
    ctx.clock.now = new Date(saved.getTime() + 31 * 86_400_000);
    try {
      expect(await validateSession(ctx, owner.token)).toBeNull();
    } finally {
      ctx.clock.now = saved;
    }
  });

  it('rate-limits repeated failed logins', async () => {
    const owner = await createOwner(ctx);
    const attempts = Array.from({ length: 11 }, () =>
      login(ctx, { email: owner.email, password: 'wrong password!' }).catch((e: unknown) => e),
    );
    const results = await Promise.all(attempts);
    expect(results.some((e) => isDomainError(e, 'rate_limited'))).toBe(true);
  });

  it('gives each user their own workspace with no membership in anyone else’s', async () => {
    const a = await createOwner(ctx);
    const b = await createOwner(ctx);
    expect(a.workspaceId).not.toBe(b.workspaceId);
    const cross = await ctx.db
      .select()
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, b.workspaceId), eq(workspaceMembers.userId, a.userId)),
      );
    expect(cross).toHaveLength(0);
    // Owners have no event memberships until they create an event.
    const memberships = await ctx.db
      .select()
      .from(eventMemberships)
      .where(eq(eventMemberships.userId, a.userId));
    expect(memberships).toHaveLength(0);
  });
});
