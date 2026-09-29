import { randomBytes } from 'node:crypto';
import { decrypt, encrypt, sha256 } from './crypto';

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export const PUBLIC_TOKEN_LENGTH = 22;
export const PUBLIC_TOKEN_PATTERN = /^[0-9A-Za-z]{22}$/;

/**
 * Token for public links and QR passes: 22 base62 characters (about 131 random bits), drawn with
 * rejection sampling so every character is uniform. Letters and digits only, so the link
 * survives being pasted into WhatsApp. Stored hashed and encrypted, never as is (see below).
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

/**
 * Invitation and pass tokens are bearer credentials, so the database never holds them in plain
 * text. Each is stored twice:
 * - `token_hash`: SHA-256 of the token, unique, used for every lookup. Tokens carry 131 random
 *   bits, so the hash can't be reversed or guessed and needs no key.
 * - `token_enc`: the token encrypted with APP_ENCRYPTION_KEY (AES-256-GCM), bound to its row, so
 *   the owner's link and the guest's QR can be rebuilt. Decrypted only to show a link or a pass.
 * packages/db/src/seal-legacy-tokens.ts writes the same format for rows created before this.
 */
export type PublicTokenKind = 'invitation' | 'pass';

export interface SealedToken {
  tokenHash: Buffer;
  tokenEnc: Buffer;
}

export function publicTokenHash(token: string): Buffer {
  return sha256(token);
}

const tokenAad = (kind: PublicTokenKind, rowId: string) => `gp.public-token:${kind}:${rowId}`;

export function sealPublicToken(
  kind: PublicTokenKind,
  rowId: string,
  token: string,
  key: Buffer,
): SealedToken {
  return {
    tokenHash: publicTokenHash(token),
    tokenEnc: encrypt(token, key, tokenAad(kind, rowId)),
  };
}

/** Recovers a stored token; throws if the ciphertext was altered, moved or doesn't match its hash. */
export function openPublicToken(
  kind: PublicTokenKind,
  rowId: string,
  sealed: SealedToken,
  key: Buffer,
): string {
  const token = decrypt(sealed.tokenEnc, key, tokenAad(kind, rowId));
  if (!publicTokenHash(token).equals(sealed.tokenHash)) {
    throw new Error(`stored ${kind} token does not match its hash`);
  }
  return token;
}
