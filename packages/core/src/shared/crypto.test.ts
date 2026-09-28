import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decrypt, encrypt } from './crypto';

describe('encrypt/decrypt', () => {
  it('round-trips and detects tampering', () => {
    const key = randomBytes(32);
    const payload = encrypt('JBSWY3DPEHPK3PXP', key);
    expect(decrypt(payload, key)).toBe('JBSWY3DPEHPK3PXP');
    payload[payload.length - 1]! ^= 1;
    expect(() => decrypt(payload, key)).toThrow();
  });
});
