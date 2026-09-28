import { randomBytes } from 'node:crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const PUBLIC_TOKEN_LENGTH = 22;
export const PUBLIC_TOKEN_PATTERN = /^[0-9A-Za-z]{22}$/;

/**
 * Token for public links and QR passes: 22 base62 characters (about 131 random bits), drawn with
 * rejection sampling so every character is uniform. Letters and digits only, so the link
 * survives being pasted into WhatsApp. Stored as is: the owner needs to see and re-share it.
 * The SQL function gp_random_token() produces the same format.
 */
export function publicToken(): string {
  let out = '';
  while (out.length < PUBLIC_TOKEN_LENGTH) {
    for (const b of randomBytes(32)) {
      if (b < 248 && out.length < PUBLIC_TOKEN_LENGTH) out += ALPHABET[b % 62];
    }
  }
  return out;
}

export function isPublicToken(value: unknown): value is string {
  return typeof value === 'string' && PUBLIC_TOKEN_PATTERN.test(value);
}
