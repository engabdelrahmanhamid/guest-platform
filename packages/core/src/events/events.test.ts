import { activity, eventMemberships, events } from '@gp/db/schema';
import { and, asc, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { updatePlatformSetting } from '../admin/admin';
import { isDomainError } from '../shared/errors';
import {
  advance,
  createOwner,
  createTestContext,
  createVerifiedAdmin,
  databaseUrl,
  eventInput,
  type TestContext,
} from '../testing/harness';
import { addStaff } from '../memberships/memberships';
import {
  createEvent,
  getEventView,
  listOwnedEvents,
  listRecentEventActivity,
  transitionEvent,
  updateEvent,
} from './events';
import { utcToLocal } from './schemas';

async function activityTypes(ctx: TestContext, eventId: string) {
  const rows = await ctx.db
    .select({ type: activity.type })
    .from(activity)
    .where(eq(activity.eventId, eventId))
    .orderBy(asc(activity.id));
  return rows.map((r) => r.type);
}

async function loadEvent(ctx: TestContext, eventId: string) {
  const [e] = await ctx.db.select().from(events).where(eq(events.id, eventId));
  return e!;
}

const rejectsWith = (code: string) => (e: unknown) => isDomainError(e) && e.code === code;

describe.skipIf(!databaseUrl)('events', () => {
  const ctx = createTestContext(new Date('2031-01-01T09:00:00Z'));

  it('creates a draft with the owner membership, converting local time to UTC', async () => {
    const owner = await createOwner(ctx);
    const { eventId, ownerMembershipId } = await createEvent(
      ctx,
      owner.userId,
      eventInput(ctx, { startsAt: '2031-01-10T20:00', mapsUrl: 'https://maps.app.goo.gl/x' }),
    );
    const e = await loadEvent(ctx, eventId);
    expect(e).toMatchObject({
      status: 'draft',
      workspaceId: owner.workspaceId,
      defaultAllowedCompanions: 2,
      // Platform defaults copied onto the event.
      autoOpenCheckin: true,
      checkinOpensOffsetMin: -180,
      assumedDurationMin: 360,
      checkinClosesOffsetMin: 360,
      reopenWindowMin: 2880,
    });
    expect(e.startsAt.toISOString()).toBe('2031-01-10T17:00:00.000Z');
    expect(utcToLocal(e.startsAt, e.timezone)).toBe('2031-01-10T20:00');

    const members = await ctx.db
      .select()
      .from(eventMemberships)
      .where(eq(eventMemberships.eventId, eventId));
    expect(members).toEqual([
      expect.objectContaining({
        id: ownerMembershipId,
        role: 'owner',
        userId: owner.userId,
        status: 'active',
      }),
    ]);
    expect(await activityTypes(ctx, eventId)).toEqual(['event.created', 'event_member.added']);
    const [created] = await ctx.db.select().from(activity).where(eq(activity.eventId, eventId));
    expect(created).toMatchObject({ actorType: 'member', actorMembershipId: ownerMembershipId });
  });

  it('validates input with field codes', async () => {
    const owner = await createOwner(ctx);
    const cases: [Record<string, unknown>, Record<string, string>][] = [
      [{ startsAt: '2030-12-01T20:00' }, { startsAt: 'must_be_future' }],
      [
        { endsAt: '2031-01-08T19:00', startsAt: '2031-01-08T20:00' },
        { endsAt: 'ends_before_start' },
      ],
      [{ timezone: 'Mars/Olympus' }, { timezone: 'invalid_timezone' }],
      [{ category: 'business', type: 'wedding' }, { type: 'type_category_mismatch' }],
      [{ mapsUrl: 'javascript:alert(1)' }, { mapsUrl: 'invalid_url' }],
      [{ name: '' }, { name: 'required' }],
      [{ defaultAllowedCompanions: '21' }, { defaultAllowedCompanions: 'out_of_range' }],
      [
        { lifecycle: { assumedDurationMin: '10' } },
        { 'lifecycle.assumedDurationMin': expect.any(String) },
      ],
    ];
    for (const [overrides, fields] of cases) {
      const err: unknown = await createEvent(ctx, owner.userId, eventInput(ctx, overrides)).catch(
        (e: unknown) => e,
      );
      expect(err).toMatchObject({ code: 'validation_failed', details: { fields } });
    }
  });

  it('stores per-event lifecycle overrides; later setting changes leave the event alone', async () => {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(
      ctx,
      owner.userId,
      eventInput(ctx, { lifecycle: { autoOpenCheckin: 'false', checkinOpensOffsetMin: '-60' } }),
    );
    const admin = await createVerifiedAdmin(ctx);
    await updatePlatformSetting(ctx, admin.principal, 'lifecycle.assumed_duration_min', 240);
    try {
      const e = await loadEvent(ctx, eventId);
      expect(e).toMatchObject({
        autoOpenCheckin: false,
        checkinOpensOffsetMin: -60,
        assumedDurationMin: 360,
      });
      const { eventId: later } = await createEvent(ctx, owner.userId, eventInput(ctx));
      expect((await loadEvent(ctx, later)).assumedDurationMin).toBe(240);
    } finally {
      await updatePlatformSetting(ctx, admin.principal, 'lifecycle.assumed_duration_min', 360);
    }
  });

  it('edits details and records only the changed field names', async () => {
    const owner = await createOwner(ctx);
    const input = eventInput(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, input);
    expect(await updateEvent(ctx, owner.userId, eventId, input)).toEqual({ changed: [] });
    const res = await updateEvent(ctx, owner.userId, eventId, {
      ...input,
      name: 'حفل زفاف محمد',
      lifecycle: { reopenWindowMin: '60' },
    });
    expect(res.changed).toEqual(['name', 'reopenWindowMin']);
    const [row] = await ctx.db
      .select()
      .from(activity)
      .where(and(eq(activity.eventId, eventId), eq(activity.type, 'event.updated')));
    expect(row?.data).toEqual({ fields: ['name', 'reopenWindowMin'] });
  });

  it('runs the full lifecycle with timestamps and one activity per transition', async () => {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    for (const action of ['activate', 'start', 'complete', 'archive'] as const) {
      advance(ctx, 1);
      const res = await transitionEvent(ctx, owner.userId, eventId, action);
      expect(res.changed).toBe(true);
    }
    const e = await loadEvent(ctx, eventId);
    expect(e.status).toBe('archived');
    for (const f of ['publishedAt', 'liveAt', 'completedAt', 'archivedAt'] as const) {
      expect(e[f]).toBeInstanceOf(Date);
    }
    expect(await activityTypes(ctx, eventId)).toEqual([
      'event.created',
      'event_member.added',
      'event.activated',
      'event.started',
      'event.completed',
      'event.archived',
    ]);
    const edit = updateEvent(ctx, owner.userId, eventId, eventInput(ctx, { name: 'x' }));
    await expect(edit).rejects.toSatisfy(rejectsWith('event_not_editable'));
  });

  it('rejects invalid transitions with structured errors', async () => {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    await expect(transitionEvent(ctx, owner.userId, eventId, 'complete')).rejects.toSatisfy(
      (e) =>
        isDomainError(e, 'invalid_transition') &&
        e.details.from === 'draft' &&
        e.details.action === 'complete',
    );
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    await transitionEvent(ctx, owner.userId, eventId, 'cancel', { reason: 'تأجيل' });
    await expect(transitionEvent(ctx, owner.userId, eventId, 'activate')).rejects.toSatisfy(
      rejectsWith('invalid_transition'),
    );
    await transitionEvent(ctx, owner.userId, eventId, 'archive');
    await expect(transitionEvent(ctx, owner.userId, eventId, 'start')).rejects.toSatisfy(
      rejectsWith('invalid_transition'),
    );
  });

  it('also rejects invalid transitions at the database level', async () => {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    await expect(
      ctx.db.execute(
        sql`UPDATE events SET status = 'completed', completed_at = now() WHERE id = ${eventId}`,
      ),
    ).rejects.toMatchObject({
      cause: { message: 'invalid event status transition draft -> completed' },
    });
  });

  it('cancels with a reason, keeps the data, and records who cancelled', async () => {
    const owner = await createOwner(ctx);
    const { eventId, ownerMembershipId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    await transitionEvent(ctx, owner.userId, eventId, 'start');
    await expect(transitionEvent(ctx, owner.userId, eventId, 'cancel')).rejects.toSatisfy(
      rejectsWith('validation_failed'),
    );
    advance(ctx, 5);
    await transitionEvent(ctx, owner.userId, eventId, 'cancel', { reason: 'ظروف طارئة' });
    const e = await loadEvent(ctx, eventId);
    expect(e).toMatchObject({
      status: 'cancelled',
      cancellationReason: 'ظروف طارئة',
      cancelledByMembershipId: ownerMembershipId,
      name: 'حفل زفاف',
    });
    expect(e.publishedAt).toBeInstanceOf(Date);
    expect(e.liveAt).toBeInstanceOf(Date);
    const [row] = await ctx.db
      .select()
      .from(activity)
      .where(and(eq(activity.eventId, eventId), eq(activity.type, 'event.cancelled')));
    expect(row).toMatchObject({ actorMembershipId: ownerMembershipId, actorUserId: owner.userId });
    expect(row?.data).toMatchObject({ from: 'live', to: 'cancelled', reason: 'ظروف طارئة' });

    await transitionEvent(ctx, owner.userId, eventId, 'archive');
    const archived = await loadEvent(ctx, eventId);
    expect(archived.cancelledAt?.getTime()).toBe(e.cancelledAt?.getTime());
  });

  it('reopens a completed event only within the reopen window', async () => {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(
      ctx,
      owner.userId,
      eventInput(ctx, { lifecycle: { reopenWindowMin: '60' } }),
    );
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    await transitionEvent(ctx, owner.userId, eventId, 'start');
    await transitionEvent(ctx, owner.userId, eventId, 'complete');
    advance(ctx, 30);
    await transitionEvent(ctx, owner.userId, eventId, 'reopen');
    const e = await loadEvent(ctx, eventId);
    expect(e.status).toBe('live');
    expect(e.reopenedAt).toBeInstanceOf(Date);

    await transitionEvent(ctx, owner.userId, eventId, 'complete');
    advance(ctx, 61);
    await expect(transitionEvent(ctx, owner.userId, eventId, 'reopen')).rejects.toSatisfy(
      rejectsWith('reopen_window_passed'),
    );
  });

  it('treats a repeated transition as done, and a stale one as an error', async () => {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    expect(await transitionEvent(ctx, owner.userId, eventId, 'activate')).toEqual({
      changed: false,
      status: 'active',
    });
    await expect(
      transitionEvent(ctx, owner.userId, eventId, 'cancel', {
        expectedStatus: 'draft',
        reason: 'x',
      }),
    ).rejects.toSatisfy(rejectsWith('stale_status'));
    expect((await activityTypes(ctx, eventId)).filter((t) => t === 'event.activated')).toHaveLength(
      1,
    );
  });

  it('applies concurrent transitions exactly once', async () => {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => transitionEvent(ctx, owner.userId, eventId, 'start')),
    );
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect((await activityTypes(ctx, eventId)).filter((t) => t === 'event.started')).toHaveLength(
      1,
    );
  });

  it('requires a verified email to activate', async () => {
    const owner = await createOwner(ctx, { verified: false });
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    await expect(transitionEvent(ctx, owner.userId, eventId, 'activate')).rejects.toSatisfy(
      rejectsWith('email_not_verified'),
    );
  });

  it('lists the owner’s events by dashboard filter, and shows allowed actions', async () => {
    const owner = await createOwner(ctx);
    const { eventId: draft } = await createEvent(ctx, owner.userId, eventInput(ctx));
    const { eventId: live } = await createEvent(ctx, owner.userId, eventInput(ctx));
    await transitionEvent(ctx, owner.userId, live, 'activate');
    await transitionEvent(ctx, owner.userId, live, 'start');

    expect((await listOwnedEvents(ctx.db, owner.userId)).map((e) => e.id).sort()).toEqual(
      [draft, live].sort(),
    );
    expect((await listOwnedEvents(ctx.db, owner.userId, 'active')).map((e) => e.id)).toEqual([
      live,
    ]);
    expect((await listOwnedEvents(ctx.db, owner.userId, 'draft')).map((e) => e.id)).toEqual([
      draft,
    ]);
    expect(await listOwnedEvents(ctx.db, owner.userId, 'archived')).toEqual([]);

    const view = await getEventView(ctx, owner.userId, live);
    expect(view.allowedActions).toEqual(['complete', 'cancel']);
    expect(view.canEdit).toBe(true);
  });

  it('lists recent event activity for the owner only, newest first, with staff names', async () => {
    // The owner's own membership entry is left out; the list starts at creation.
    const owner = await createOwner(ctx);
    const other = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    await addStaff(ctx, owner.userId, eventId, { displayName: 'منيرة' });
    await transitionEvent(ctx, owner.userId, eventId, 'activate');

    const items = await listRecentEventActivity(ctx, owner.userId, eventId, 3);
    expect(items.map((i) => i.type)).toEqual([
      'event.activated',
      'event_member.added',
      'event.created',
    ]);
    expect(items[1]).toMatchObject({ memberName: 'منيرة', bySchedule: false });
    expect(items[0]!.memberName).toBeNull();

    await expect(listRecentEventActivity(ctx, other.userId, eventId)).rejects.toSatisfy(
      rejectsWith('not_found'),
    );
  });
});
