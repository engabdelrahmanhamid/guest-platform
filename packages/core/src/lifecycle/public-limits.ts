import { createHmac } from 'node:crypto';
import { consumeRateLimit, isRateLimited } from '../identity/rate-limit';
import type { DbOrTx } from '../shared/context';
import { sha256 } from '../shared/crypto';
import { DomainError } from '../shared/errors';

/**
 * Limits for the public invitation endpoints. Tokens are 131-bit random values, so guessing is
 * hopeless anyway; these limits keep one client from hammering the pages, and cut off a client
 * that keeps presenting unknown tokens. `client` is a keyed hash of the IP address, never the IP.
 */
const LIMITS = {
  view: { limit: 120, window: 300 },
  open: { limit: 60, window: 300 },
  rsvpClient: { limit: 60, window: 600 },
  rsvpToken: { limit: 20, window: 600 },
  badToken: { limit: 30, window: 900 },
} as const;

export type PublicRequestKind = 'view' | 'open' | 'rsvp';

/** Counts one public request; throws `rate_limited` when the client or the link is over its limit. */
export async function guardPublicRequest(
  db: DbOrTx,
  kind: PublicRequestKind,
  client: string,
  token: string,
  now: Date,
): Promise<void> {
  const bad = LIMITS.badToken;
  if (await isRateLimited(db, `pub:bad:${client}`, bad.limit, bad.window, now)) {
    throw new DomainError('rate_limited', undefined, { retryAfterSeconds: bad.window });
  }
  if (kind === 'rsvp') {
    await consumeRateLimit(
      db,
      `pub:rsvp:${client}`,
      LIMITS.rsvpClient.limit,
      LIMITS.rsvpClient.window,
      now,
    );
    // Counted per link too, under a hash so the counter table never holds a usable token.
    const link = sha256(token).toString('hex').slice(0, 32);
    await consumeRateLimit(
      db,
      `pub:rsvp-link:${link}`,
      LIMITS.rsvpToken.limit,
      LIMITS.rsvpToken.window,
      now,
    );
    return;
  }
  const l = LIMITS[kind];
  await consumeRateLimit(db, `pub:${kind}:${client}`, l.limit, l.window, now);
}

/** Records a request for a token that doesn't exist. */
export async function noteUnknownToken(db: DbOrTx, client: string, now: Date): Promise<void> {
  const bad = LIMITS.badToken;
  await consumeRateLimit(db, `pub:bad:${client}`, bad.limit + 1, bad.window, now).catch(
    () => undefined,
  );
}

/**
 * A stable, keyed hash of the caller's IP address for the counters above. The address itself is
 * never stored; requests without one share a bucket.
 */
export function publicClientKey(ip: string | undefined, secret: Buffer): string {
  return createHmac('sha256', secret)
    .update(ip ?? 'unknown')
    .digest('base64url')
    .slice(0, 22);
}
