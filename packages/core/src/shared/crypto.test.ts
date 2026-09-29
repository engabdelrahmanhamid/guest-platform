import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sealLegacyToken } from '@gp/db';
import { decrypt, encrypt } from './crypto';
import { openPublicToken, publicToken, publicTokenHash, sealPublicToken } from './tokens';

describe('encrypt/decrypt', () => {
  it('round-trips and detects tampering', () => {
    const key = randomBytes(32);
    const payload = encrypt('JBSWY3DPEHPK3PXP', key);
    expect(decrypt(payload, key)).toBe('JBSWY3DPEHPK3PXP');
    payload[payload.length - 1]! ^= 1;
    expect(() => decrypt(payload, key)).toThrow();
  });
});

describe('public token storage', () => {
  const key = randomBytes(32);
  const id = '0192f000-0000-7000-8000-000000000001';

  it('stores a hash for lookup and a row-bound ciphertext, never the token', () => {
    const token = publicToken();
    const sealed = sealPublicToken('pass', id, token, key);
    expect(sealed.tokenHash.equals(publicTokenHash(token))).toBe(true);
    expect(sealed.tokenEnc.includes(Buffer.from(token))).toBe(false);
    expect(openPublicToken('pass', id, sealed, key)).toBe(token);
  });

  it('refuses a ciphertext moved to another row or kind, or a wrong key', () => {
    const sealed = sealPublicToken('pass', id, publicToken(), key);
    const other = '0192f000-0000-7000-8000-000000000002';
    expect(() => openPublicToken('pass', other, sealed, key)).toThrow();
    expect(() => openPublicToken('invitation', id, sealed, key)).toThrow();
    expect(() => openPublicToken('pass', id, sealed, randomBytes(32))).toThrow();
  });

  it('refuses a ciphertext that does not match its hash', () => {
    const a = sealPublicToken('pass', id, publicToken(), key);
    const b = sealPublicToken('pass', id, publicToken(), key);
    expect(() =>
      openPublicToken('pass', id, { tokenHash: a.tokenHash, tokenEnc: b.tokenEnc }, key),
    ).toThrow(/does not match/);
  });

  it('reads tokens the migration runner encrypted', () => {
    const token = publicToken();
    const tokenEnc = sealLegacyToken('invitation', id, token, key);
    expect(
      openPublicToken('invitation', id, { tokenHash: publicTokenHash(token), tokenEnc }, key),
    ).toBe(token);
  });
});
