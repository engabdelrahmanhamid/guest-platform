import { eventMemberships } from '@gp/db/schema';
import { and, asc, eq, ne } from 'drizzle-orm';
import { z } from 'zod';
import { recordActivity } from '../activity/activity';
import { type EventAccess, requireEventAccess } from '../authorization/authorization';
import { isEditable } from '../events/lifecycle';
import type { CoreContext, Tx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import { normalizePhone } from '../shared/phone';
import { parseInput } from '../shared/validation';

/**
 * Staff are event memberships with no user account. Their passwordless access link arrives in
 * phase 4; until then a staff membership is `invited`.
 */
export const addStaffSchema = z.object({
  displayName: z
    .string({ message: 'required' })
    .trim()
    .min(1, { message: 'required' })
    .max(80, { message: 'too_long' }),
  phone: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    z
      .string()
      .transform((v, ctx) => {
        const e164 = normalizePhone(v);
        if (!e164) {
          ctx.addIssue({ code: 'custom', message: 'invalid_phone' });
          return z.NEVER;
        }
        return e164;
      })
      .optional(),
  ),
  isSupervisor: z
    .preprocess((v) => v === 'on' || v === 'true' || v === true, z.boolean())
    .default(false),
});

async function lockForMemberChange(tx: Tx, userId: string, eventId: string): Promise<EventAccess> {
  const access = await requireEventAccess(tx, userId, eventId, 'members.manage', {
    forUpdate: true,
  });
  if (access.event.disabledAt) throw new DomainError('event_disabled');
  if (!isEditable(access.event)) {
    throw new DomainError('event_not_editable', undefined, { status: access.event.status });
  }
  return access;
}

async function loadMembership(tx: Tx, eventId: string, membershipId: string) {
  const [m] = await tx
    .select()
    .from(eventMemberships)
    .where(and(eq(eventMemberships.id, membershipId), eq(eventMemberships.eventId, eventId)))
    .for('update');
  if (!m) throw new DomainError('not_found');
  return m;
}

export async function addStaff(ctx: CoreContext, userId: string, eventId: string, input: unknown) {
  const data = parseInput(addStaffSchema, input);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await lockForMemberChange(tx, userId, eventId);
    const membershipId = newId();
    await tx.insert(eventMemberships).values({
      id: membershipId,
      eventId,
      userId: null,
      role: 'staff',
      isSupervisor: data.isSupervisor,
      displayName: data.displayName,
      phoneE164: data.phone ?? null,
      status: 'invited',
      createdByMembershipId: actor.membershipId,
      createdAt: now,
      updatedAt: now,
    });
    await recordActivity(tx, {
      type: 'event_member.added',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { membershipId, role: 'staff', isSupervisor: data.isSupervisor },
    });
    return { membershipId };
  });
}

/** Soft-removes a staff membership; the row and its history stay. Removing twice is a no-op. */
export async function removeStaff(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  membershipId: string,
): Promise<{ changed: boolean }> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await lockForMemberChange(tx, userId, eventId);
    const m = await loadMembership(tx, eventId, membershipId);
    if (m.role === 'owner') throw new DomainError('cannot_remove_owner');
    if (m.status === 'removed') return { changed: false };
    await tx
      .update(eventMemberships)
      .set({
        status: 'removed',
        removedAt: now,
        removedByMembershipId: actor.membershipId,
        updatedAt: now,
      })
      .where(eq(eventMemberships.id, membershipId));
    await recordActivity(tx, {
      type: 'event_member.removed',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { membershipId },
    });
    return { changed: true };
  });
}

/** Turns the supervisor flag on or off for a staff member. Idempotent. */
export async function setSupervisor(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  membershipId: string,
  enabled: boolean,
): Promise<{ changed: boolean }> {
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await lockForMemberChange(tx, userId, eventId);
    const m = await loadMembership(tx, eventId, membershipId);
    if (m.role !== 'staff') throw new DomainError('membership_not_staff');
    if (m.status === 'removed') throw new DomainError('membership_removed');
    if (m.isSupervisor === enabled) return { changed: false };
    await tx
      .update(eventMemberships)
      .set({ isSupervisor: enabled, updatedAt: now })
      .where(eq(eventMemberships.id, membershipId));
    await recordActivity(tx, {
      type: enabled ? 'event_member.supervisor_enabled' : 'event_member.supervisor_disabled',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { membershipId },
    });
    return { changed: true };
  });
}

export async function listMemberships(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  opts: { includeRemoved?: boolean } = {},
) {
  await requireEventAccess(ctx.db, userId, eventId, 'members.view');
  return ctx.db
    .select({
      id: eventMemberships.id,
      role: eventMemberships.role,
      isSupervisor: eventMemberships.isSupervisor,
      displayName: eventMemberships.displayName,
      phoneE164: eventMemberships.phoneE164,
      status: eventMemberships.status,
      createdAt: eventMemberships.createdAt,
      removedAt: eventMemberships.removedAt,
    })
    .from(eventMemberships)
    .where(
      and(
        eq(eventMemberships.eventId, eventId),
        opts.includeRemoved ? undefined : ne(eventMemberships.status, 'removed'),
      ),
    )
    .orderBy(asc(eventMemberships.createdAt));
}
