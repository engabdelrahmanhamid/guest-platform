import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** URL-safe random token with 256 bits of entropy. Only its hash is stored. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

/**
 * AES-256-GCM. Output layout: 12-byte IV, 16-byte tag, ciphertext. `aad` binds the ciphertext to
 * where it is stored (for example a row id), so a value copied to another row fails to decrypt.
 */
export function encrypt(plaintext: string, key: Buffer, aad?: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  if (aad !== undefined) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(payload: Buffer, key: Buffer, aad?: string): string {
  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
  if (aad !== undefined) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
}
