import { activity, events } from '@gp/db/schema';
import { and, eq, like } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { setEventDisabled, updatePlatformSetting } from '../admin/admin';
import { createEvent, transitionEvent } from '../events/events';
import {
  createOwner,
  createTestContext,
  createVerifiedAdmin,
  databaseUrl,
  eventInput,
  type TestContext,
} from '../testing/harness';
import { runLifecycleTick } from './lifecycle-scheduler';

/**
 * These tests use a clock years before every other test file's, so the scheduler (which scans
 * all events) never touches events other tests are asserting on.
 */
const LIFECYCLE = {
  autoOpenCheckin: 'true',
  checkinOpensOffsetMin: '-60',
  assumedDurationMin: '120',
  autoCloseCheckin: 'true',
  checkinClosesOffsetMin: '60',
  reopenWindowMin: '30',
};

async function status(ctx: TestContext, eventId: string) {
  const [e] = await ctx.db.select().from(events).where(eq(events.id, eventId));
  return e!;
}

async function transitionActivity(ctx: TestContext, eventId: string) {
  const rows = await ctx.db
    .select({ type: activity.type, actorType: activity.actorType, data: activity.data })
    .from(activity)
    .where(and(eq(activity.eventId, eventId), like(activity.type, 'event.%')));
  return rows.filter((r) => r.type !== 'event.created');
}

describe.skipIf(!databaseUrl)('lifecycle scheduler', () => {
  const ctx = createTestContext(new Date('2021-06-01T09:00:00Z'));
  const at = (iso: string) => new Date(iso);

  async function activeEvent(lifecycle: Partial<typeof LIFECYCLE> = {}) {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(
      ctx,
      owner.userId,
      eventInput(ctx, { startsAt: '2021-06-10T20:00', lifecycle: { ...LIFECYCLE, ...lifecycle } }),
    );
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    return { owner, eventId };
  }

  it('opens and closes check-in at the configured times, as the system actor', async () => {
    const { eventId } = await activeEvent();
    // Starts 17:00Z; opens 60 min before; ends 19:00Z; closes 60 min after.
    await runLifecycleTick(ctx.db, at('2021-06-10T15:59:00Z'));
    expect((await status(ctx, eventId)).status).toBe('active');
    await runLifecycleTick(ctx.db, at('2021-06-10T16:00:00Z'));
    expect((await status(ctx, eventId)).status).toBe('live');
    await runLifecycleTick(ctx.db, at('2021-06-10T19:59:00Z'));
    expect((await status(ctx, eventId)).status).toBe('live');
    await runLifecycleTick(ctx.db, at('2021-06-10T20:00:00Z'));
    const e = await status(ctx, eventId);
    expect(e.status).toBe('completed');
    expect(e.liveAt?.toISOString()).toBe('2021-06-10T16:00:00.000Z');
    expect(e.completedAt?.toISOString()).toBe('2021-06-10T20:00:00.000Z');
    expect(await transitionActivity(ctx, eventId)).toEqual([
      expect.objectContaining({ type: 'event.activated', actorType: 'member' }),
      {
        type: 'event.started',
        actorType: 'system',
        data: { from: 'active', to: 'live', trigger: 'schedule' },
      },
      {
        type: 'event.completed',
        actorType: 'system',
        data: { from: 'live', to: 'completed', trigger: 'schedule' },
      },
    ]);
  });

  it('is safe to run repeatedly and concurrently: one transition, one activity row', async () => {
    const { eventId } = await activeEvent();
    const now = at('2021-06-10T16:30:00Z');
    await Promise.all(Array.from({ length: 5 }, () => runLifecycleTick(ctx.db, now)));
    await runLifecycleTick(ctx.db, now);
    expect(await runLifecycleTick(ctx.db, now)).toEqual({ started: 0, completed: 0, archived: 0 });
    const started = (await transitionActivity(ctx, eventId)).filter(
      (r) => r.type === 'event.started',
    );
    expect(started).toHaveLength(1);
  });

  it('leaves events alone when auto open/close is off, disabled, or reopened', async () => {
    const noAuto = await activeEvent({ autoOpenCheckin: 'false' });
    const disabled = await activeEvent();
    const admin = await createVerifiedAdmin(ctx);
    await setEventDisabled(ctx, admin.principal, disabled.eventId, true, 'x');
    const reopened = await activeEvent({ reopenWindowMin: '600' });
    await runLifecycleTick(ctx.db, at('2021-06-10T16:00:00Z'));
    await runLifecycleTick(ctx.db, at('2021-06-10T20:00:00Z'));
    expect((await status(ctx, reopened.eventId)).status).toBe('completed');
    ctx.clock.now = at('2021-06-10T20:10:00Z');
    await transitionEvent(ctx, reopened.owner.userId, reopened.eventId, 'reopen');

    await runLifecycleTick(ctx.db, at('2021-06-12T00:00:00Z'));
    expect((await status(ctx, noAuto.eventId)).status).toBe('active');
    expect((await status(ctx, disabled.eventId)).status).toBe('active');
    expect((await status(ctx, reopened.eventId)).status).toBe('live');
    ctx.clock.now = at('2021-06-01T09:00:00Z');
  });

  it('auto-archives completed and cancelled events after the configured days', async () => {
    const admin = await createVerifiedAdmin(ctx);
    const done = await activeEvent();
    const cancelled = await activeEvent();
    ctx.clock.now = at('2021-06-05T00:00:00Z');
    await transitionEvent(ctx, cancelled.owner.userId, cancelled.eventId, 'cancel', {
      reason: 'x',
    });
    ctx.clock.now = at('2021-06-01T09:00:00Z');
    await runLifecycleTick(ctx.db, at('2021-06-10T16:00:00Z'));
    await runLifecycleTick(ctx.db, at('2021-06-10T20:00:00Z'));

    // Default is 90 days.
    await runLifecycleTick(ctx.db, at('2021-09-02T00:00:00Z'));
    expect((await status(ctx, cancelled.eventId)).status).toBe('cancelled');
    await runLifecycleTick(ctx.db, at('2021-09-03T00:00:01Z'));
    expect((await status(ctx, cancelled.eventId)).status).toBe('archived');
    expect((await status(ctx, done.eventId)).status).toBe('completed');
    await runLifecycleTick(ctx.db, at('2021-09-08T20:00:00Z'));
    const archived = await status(ctx, done.eventId);
    expect(archived.status).toBe('archived');
    expect(archived.completedAt?.toISOString()).toBe('2021-06-10T20:00:00.000Z');

    // Turning auto-archive off stops it.
    await updatePlatformSetting(ctx, admin.principal, 'auto_archive.days', null);
    try {
      const later = await activeEvent();
      await runLifecycleTick(ctx.db, at('2021-06-10T16:00:00Z'));
      await runLifecycleTick(ctx.db, at('2021-06-10T20:00:00Z'));
      await runLifecycleTick(ctx.db, at('2025-01-01T00:00:00Z'));
      expect((await status(ctx, later.eventId)).status).toBe('completed');
    } finally {
      await updatePlatformSetting(ctx, admin.principal, 'auto_archive.days', 90);
    }
  });
});
