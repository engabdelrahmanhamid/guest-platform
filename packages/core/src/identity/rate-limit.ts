import { sql } from 'drizzle-orm';
import { DomainError } from '../shared/errors';
import type { DbOrTx } from '../shared/context';

/**
 * Fixed-window counter stored in Postgres, so limits hold across web instances.
 * Throws `rate_limited` once `limit` is exceeded within `windowSeconds`.
 */
export async function consumeRateLimit(
  db: DbOrTx,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: Date,
): Promise<void> {
  const windowStartCutoff = new Date(now.getTime() - windowSeconds * 1000);
  const result = await db.execute<{ count: number }>(sql`
    INSERT INTO auth_rate_limits (bucket, window_start, count)
    VALUES (${bucket}, ${now}, 1)
    ON CONFLICT (bucket) DO UPDATE SET
      count = CASE WHEN auth_rate_limits.window_start < ${windowStartCutoff} THEN 1
                   ELSE auth_rate_limits.count + 1 END,
      window_start = CASE WHEN auth_rate_limits.window_start < ${windowStartCutoff} THEN ${now}
                          ELSE auth_rate_limits.window_start END
    RETURNING count`);
  const count = Number(result.rows[0]?.count ?? 0);
  if (count > limit) {
    throw new DomainError('rate_limited', 'Too many attempts', {
      retryAfterSeconds: windowSeconds,
    });
  }
}
