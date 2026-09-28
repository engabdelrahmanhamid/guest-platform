import { Secret, TOTP } from 'otpauth';
import { describe, expect, it } from 'vitest';
import { requireAdmin } from '../authorization/authorization';
import { isDomainError } from '../shared/errors';
import {
  advance,
  createAdmin,
  createTestContext,
  databaseUrl,
  principalFor,
} from '../testing/harness';
import { beginTotpEnrollment, confirmTotpEnrollment, verifyTotp } from './totp';
import { login } from './auth';
import { PASSWORD } from '../testing/harness';

function codeAt(secret: string, at: Date): string {
  return new TOTP({ secret: Secret.fromBase32(secret) }).generate({ timestamp: at.getTime() });
}

describe.skipIf(!databaseUrl)('admin two-factor (TOTP)', () => {
  const ctx = createTestContext();

  it('requires enrollment, then a code on every new session, and rejects replays', async () => {
    const admin = await createAdmin(ctx);
    let principal = await principalFor(ctx, admin.token);
    expect(() => requireAdmin(principal)).toThrow(
      expect.objectContaining({ code: 'mfa_required' }),
    );

    const { secret, uri } = await beginTotpEnrollment(ctx, admin.userId);
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    await expect(
      confirmTotpEnrollment(ctx, admin.userId, principal.session.id, '000000'),
    ).rejects.toSatisfy((e) => isDomainError(e, 'invalid_totp_code'));
    await confirmTotpEnrollment(ctx, admin.userId, principal.session.id, codeAt(secret, ctx.now()));
    principal = await principalFor(ctx, admin.token);
    expect(requireAdmin(principal).user.id).toBe(admin.userId);

    // A fresh login starts without the second factor.
    const { session, mfaRequired } = await login(ctx, { email: admin.email, password: PASSWORD });
    expect(mfaRequired).toBe(true);
    const fresh = await principalFor(ctx, session.token);
    expect(() => requireAdmin(fresh)).toThrow(expect.objectContaining({ code: 'mfa_required' }));

    // The code used for enrollment can't be replayed.
    await expect(
      verifyTotp(ctx, admin.userId, fresh.session.id, codeAt(secret, ctx.now())),
    ).rejects.toSatisfy((e) => isDomainError(e, 'invalid_totp_code'));
    advance(ctx, 1);
    await verifyTotp(ctx, admin.userId, fresh.session.id, codeAt(secret, ctx.now()));
    expect(requireAdmin(await principalFor(ctx, session.token)).user.id).toBe(admin.userId);
  });

  it('never grants admin access to a non-admin, whatever their session', async () => {
    const admin = await createAdmin(ctx);
    const p = await principalFor(ctx, admin.token);
    const owner = { ...p, user: { ...p.user, platformRole: 'none' as const, totpEnabled: true } };
    expect(() =>
      requireAdmin({ ...owner, session: { ...owner.session, mfaVerified: true } }),
    ).toThrow(expect.objectContaining({ code: 'forbidden' }));
    expect(() => requireAdmin(null)).toThrow(expect.objectContaining({ code: 'unauthenticated' }));
  });
});
