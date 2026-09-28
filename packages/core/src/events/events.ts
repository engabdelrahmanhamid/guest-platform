import { eventMemberships, events, users, workspaceMembers } from '@gp/db/schema';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { z } from 'zod';
import { type Actor, recordActivity } from '../activity/activity';
import { type EventRow, requireEventAccess } from '../authorization/authorization';
import { getLifecycleDefaults } from '../settings/settings';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import { parseInput } from '../shared/validation';
import { getPersonalWorkspaceId } from '../workspaces/workspaces';
import {
  allowedTransitions,
  checkTransition,
  type EventStatus,
  isEditable,
  lifecycleTimes,
  TRANSITIONS,
  type TransitionAction,
} from './lifecycle';
import { cancellationReasonSchema, eventDetailsSchema, type EventDetails } from './schemas';

/** Columns the owner edits through the details form. */
const DETAIL_FIELDS = [
  'category',
  'type',
  'name',
  'startsAt',
  'endsAt',
  'timezone',
  'city',
  'venueName',
  'address',
  'mapsUrl',
  'description',
  'coverImageKey',
  'logoKey',
  'defaultAllowedCompanions',
  'autoOpenCheckin',
  'checkinOpensOffsetMin',
  'assumedDurationMin',
  'autoCloseCheckin',
  'checkinClosesOffsetMin',
  'reopenWindowMin',
] as const;

function flatten(d: EventDetails) {
  const { lifecycle, ...rest } = d;
  return { ...rest, ...lifecycle };
}

function assertStartsInFuture(startsAt: Date, now: Date) {
  if (startsAt.getTime() <= now.getTime()) {
    throw new DomainError('validation_failed', 'Start must be in the future', {
      fields: { startsAt: 'must_be_future' },
    });
  }
}

/**
 * Creates a draft event in the owner's personal workspace. The event stores the effective
 * lifecycle values (platform defaults plus the owner's overrides), and the owner membership is
 * created in the same transaction.
 */
export async function createEvent(ctx: CoreContext, userId: string, input: unknown) {
  const { lifecycle, ...details } = parseInput(eventDetailsSchema, input);
  const now = ctx.now();
  assertStartsInFuture(details.startsAt, now);

  return ctx.db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    if (!user || user.status !== 'active') throw new DomainError('unauthenticated');
    const workspaceId = await getPersonalWorkspaceId(tx, userId);
    const defaults = await getLifecycleDefaults(tx);
    const eventId = newId();
    const membershipId = newId();

    await tx.insert(events).values({
      id: eventId,
      workspaceId,
      ...details,
      ...defaults,
      ...lifecycle,
      status: 'draft',
      createdByUserId: userId,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(eventMemberships).values({
      id: membershipId,
      eventId,
      userId,
      role: 'owner',
      displayName: user.fullName.slice(0, 80),
      status: 'active',
      createdAt: now,
      updatedAt: now,
    });
    const actor: Actor = { type: 'member', membershipId, userId };
    await recordActivity(tx, {
      type: 'event.created',
      actor,
      eventId,
      workspaceId,
      data: { category: details.category, type: details.type },
    });
    await recordActivity(tx, {
      type: 'event_member.added',
      actor,
      eventId,
      workspaceId,
      data: { membershipId, role: 'owner' },
    });
    return { eventId, ownerMembershipId: membershipId };
  });
}

/** Replaces the event's details. Records which fields changed (names only, not values). */
export async function updateEvent(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  input: unknown,
): Promise<{ changed: string[] }> {
  const details = flatten(parseInput(eventDetailsSchema, input));
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireEventAccess(tx, userId, eventId, 'event.edit', {
      forUpdate: true,
    });
    if (event.disabledAt) throw new DomainError('event_disabled');
    if (!isEditable(event))
      throw new DomainError('event_not_editable', undefined, { status: event.status });

    const changed = DETAIL_FIELDS.filter((f) => {
      const next = details[f];
      if (next === undefined) return false;
      const prev = event[f];
      return prev instanceof Date && next instanceof Date
        ? prev.getTime() !== next.getTime()
        : prev !== next;
    });
    if (changed.length === 0) return { changed };
    if (changed.includes('startsAt') && event.status !== 'live') {
      assertStartsInFuture(details.startsAt, now);
    }

    const patch: Partial<typeof events.$inferInsert> = { updatedAt: now };
    for (const f of changed) Object.assign(patch, { [f]: details[f] });
    await tx.update(events).set(patch).where(eq(events.id, eventId));
    await recordActivity(tx, {
      type: 'event.updated',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { fields: changed },
    });
    return { changed };
  });
}

export interface TransitionResult {
  changed: boolean;
  status: EventStatus;
}

/**
 * Applies a transition to an event row already locked by the caller. Uses compare-and-set on
 * the status so two writers can never both apply it, and writes exactly one activity row.
 */
export async function applyTransition(
  tx: DbOrTx,
  event: EventRow,
  action: TransitionAction,
  actor: Actor,
  now: Date,
  opts: { reason?: string; trigger: 'manual' | 'schedule' },
): Promise<TransitionResult> {
  const rule = TRANSITIONS[action];
  const patch: Partial<typeof events.$inferInsert> = { status: rule.to, updatedAt: now };
  const data: Record<string, unknown> = { from: event.status, to: rule.to, trigger: opts.trigger };
  switch (action) {
    case 'activate':
      patch.publishedAt = now;
      break;
    case 'start':
      patch.liveAt = event.liveAt ?? now;
      break;
    case 'complete':
      patch.completedAt = now;
      break;
    case 'cancel':
      patch.cancelledAt = now;
      patch.cancellationReason = opts.reason ?? null;
      patch.cancelledByMembershipId = actor.type === 'member' ? actor.membershipId : null;
      data.reason = opts.reason;
      break;
    case 'archive':
      patch.archivedAt = now;
      break;
    case 'reopen':
      patch.reopenedAt = now;
      patch.completedAt = null;
      data.previousCompletedAt = event.completedAt?.toISOString();
      break;
  }
  const updated = await tx
    .update(events)
    .set(patch)
    .where(and(eq(events.id, event.id), eq(events.status, event.status)))
    .returning({ id: events.id });
  if (updated.length === 0) throw new DomainError('stale_status');
  await recordActivity(tx, {
    type: rule.activity,
    actor,
    eventId: event.id,
    workspaceId: event.workspaceId,
    data,
  });
  return { changed: true, status: rule.to };
}

/**
 * Owner-initiated lifecycle transition. Idempotent: asking for the state the event is already
 * in succeeds without writing anything. `expectedStatus` (the status the owner was looking at)
 * turns a lost race into `stale_status` instead of a surprising transition.
 */
export async function transitionEvent(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  action: TransitionAction,
  opts: { expectedStatus?: EventStatus; reason?: string } = {},
): Promise<TransitionResult> {
  const reason =
    action === 'cancel'
      ? parseInput(z.object({ reason: cancellationReasonSchema }), { reason: opts.reason }).reason
      : undefined;
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireEventAccess(tx, userId, eventId, 'event.transition', {
      forUpdate: true,
    });
    const rule = TRANSITIONS[action];
    if (event.status === rule.to && !event.disabledAt) {
      return { changed: false, status: event.status };
    }
    if (opts.expectedStatus && opts.expectedStatus !== event.status) {
      throw new DomainError('stale_status', undefined, { status: event.status });
    }
    const check = checkTransition(event, action, now);
    if (!check.ok) {
      throw new DomainError(check.code, undefined, { from: event.status, action });
    }
    if (action === 'activate') {
      const [user] = await tx
        .select({ verified: users.emailVerifiedAt })
        .from(users)
        .where(eq(users.id, userId));
      if (!user?.verified) throw new DomainError('email_not_verified');
    }
    return applyTransition(tx, event, action, actor, now, {
      ...(reason ? { reason } : {}),
      trigger: 'manual',
    });
  });
}

/** Event plus derived lifecycle times and what the caller may do next. */
export async function getEventView(ctx: CoreContext, userId: string, eventId: string) {
  const access = await requireEventAccess(ctx.db, userId, eventId, 'event.view');
  const { event, membership } = access;
  const isOwner = membership.role === 'owner';
  const now = ctx.now();
  return {
    event,
    membership,
    times: lifecycleTimes(event),
    allowedActions: isOwner ? allowedTransitions(event, now) : [],
    canEdit: isOwner && isEditable(event),
    canManageMembers: isOwner && isEditable(event),
  };
}

export const DASHBOARD_FILTERS = [
  'all',
  'draft',
  'active',
  'completed',
  'cancelled',
  'archived',
] as const;
export type DashboardFilter = (typeof DASHBOARD_FILTERS)[number];

/**
 * Events the user owns, newest start first. The "active" filter includes live events, since
 * both are upcoming or running from the owner's point of view.
 */
export async function listOwnedEvents(db: DbOrTx, userId: string, filter: DashboardFilter = 'all') {
  const statuses: EventStatus[] | null =
    filter === 'all' ? null : filter === 'active' ? ['active', 'live'] : [filter];
  return db
    .select({
      id: events.id,
      name: events.name,
      startsAt: events.startsAt,
      timezone: events.timezone,
      status: events.status,
      type: events.type,
      disabledAt: events.disabledAt,
    })
    .from(events)
    .innerJoin(
      eventMemberships,
      and(
        eq(eventMemberships.eventId, events.id),
        eq(eventMemberships.userId, userId),
        eq(eventMemberships.role, 'owner'),
        ne(eventMemberships.status, 'removed'),
      ),
    )
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, events.workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(statuses ? inArray(events.status, statuses) : undefined)
    .orderBy(desc(events.startsAt));
}
