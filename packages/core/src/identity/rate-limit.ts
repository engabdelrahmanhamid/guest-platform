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

/** Whether a bucket is already over `limit` in its current window, without counting a hit. */
export async function isRateLimited(
  db: DbOrTx,
  bucket: string,
  limit: number,
  windowSeconds: number,
  now: Date,
): Promise<boolean> {
  const cutoff = new Date(now.getTime() - windowSeconds * 1000);
  const result = await db.execute<{ count: number }>(sql`
    SELECT count FROM auth_rate_limits WHERE bucket = ${bucket} AND window_start >= ${cutoff}`);
  return Number(result.rows[0]?.count ?? 0) > limit;
}

/** Drops counters whose window ended long ago (they would restart at 1 anyway). */
export async function purgeRateLimits(db: DbOrTx, now: Date): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM auth_rate_limits WHERE window_start < ${new Date(now.getTime() - 86_400_000)}`);
  return result.rowCount ?? 0;
}
