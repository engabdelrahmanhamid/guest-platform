import { events } from '@gp/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@gp/db';
import { applyTransition } from '../events/events';
import { scheduledTransition, type TransitionAction } from '../events/lifecycle';
import { getAllSettings } from '../settings/settings';

export interface TickResult {
  started: number;
  completed: number;
  archived: number;
}

const SYSTEM = { type: 'system' } as const;

/**
 * Handles one event at a time in its own transaction. The row is locked with SKIP LOCKED and
 * re-checked after locking, so overlapping runs (two workers, a retried job) can't apply the same
 * transition twice or write duplicate activity.
 */
async function runOne(
  db: Database,
  eventId: string,
  now: Date,
  decide: (event: typeof events.$inferSelect) => TransitionAction | null,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [event] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for('update', { skipLocked: true });
    if (!event) return false;
    const action = decide(event);
    if (!action) return false;
    await applyTransition(tx, event, action, SYSTEM, now, { trigger: 'schedule' });
    return true;
  });
}

async function runAll(
  db: Database,
  ids: { id: string }[],
  now: Date,
  decide: (event: typeof events.$inferSelect) => TransitionAction | null,
): Promise<number> {
  let n = 0;
  for (const { id } of ids) if (await runOne(db, id, now, decide)) n++;
  return n;
}

const minutes = (col: unknown) => sql`make_interval(mins => ${col})`;

/**
 * One scheduler pass: opens check-in (active → live), closes it (live → completed) and
 * auto-archives old completed or cancelled events, each per the event's stored configuration.
 * Safe to run any number of times for the same `now`.
 */
export async function runLifecycleTick(db: Database, now: Date): Promise<TickResult> {
  const notDisabled = isNull(events.disabledAt);

  const toStart = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.status, 'active'),
        eq(events.autoOpenCheckin, true),
        notDisabled,
        sql`${events.startsAt} + ${minutes(events.checkinOpensOffsetMin)} <= ${now}`,
      ),
    );
  const started = await runAll(db, toStart, now, (e) =>
    scheduledTransition(e, now) === 'start' ? 'start' : null,
  );

  const toComplete = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.status, 'live'),
        eq(events.autoCloseCheckin, true),
        isNull(events.reopenedAt),
        notDisabled,
        sql`coalesce(${events.endsAt}, ${events.startsAt} + ${minutes(events.assumedDurationMin)})
            + ${minutes(events.checkinClosesOffsetMin)} <= ${now}`,
      ),
    );
  const completed = await runAll(db, toComplete, now, (e) =>
    scheduledTransition(e, now) === 'complete' ? 'complete' : null,
  );

  let archived = 0;
  const days = (await getAllSettings(db))['auto_archive.days'];
  if (days !== null) {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    // A completed event is never archived while it can still be reopened.
    const toArchive = await db
      .select({ id: events.id })
      .from(events)
      .where(
        and(
          notDisabled,
          sql`(
            (${events.status} = 'cancelled' AND ${events.cancelledAt} <= ${cutoff})
            OR (${events.status} = 'completed' AND ${events.completedAt} <= ${cutoff}
                AND ${events.completedAt} + ${minutes(events.reopenWindowMin)} <= ${now})
          )`,
        ),
      );
    archived = await runAll(db, toArchive, now, (e) => {
      if (e.disabledAt) return null;
      if (e.status === 'cancelled' && e.cancelledAt && e.cancelledAt <= cutoff) return 'archive';
      if (
        e.status === 'completed' &&
        e.completedAt &&
        e.completedAt <= cutoff &&
        e.completedAt.getTime() + e.reopenWindowMin * 60_000 <= now.getTime()
      ) {
        return 'archive';
      }
      return null;
    });
  }

  return { started, completed, archived };
}
