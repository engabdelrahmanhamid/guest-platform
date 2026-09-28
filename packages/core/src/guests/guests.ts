import { activity, eventMemberships, guestGroups, guests, invitations, rsvps } from '@gp/db/schema';
import { and, asc, count, desc, eq, gt, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import { type ActivityInput, recordActivities, recordActivity } from '../activity/activity';
import type { EventAccess } from '../authorization/authorization';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import { phoneSearchDigits } from '../shared/phone';
import { escapeLike, searchForm } from '../shared/text';
import { parseInput } from '../shared/validation';
import { issuePass, revokeActivePass, revokeActivePasses } from '../lifecycle/passes';
import { createGuestLifecycle } from '../lifecycle/records';
import { requireGuestManagement, requireGuestView } from './access';
import {
  cancelInputSchema,
  companionsSchema,
  type GuestInput,
  guestIdsSchema,
  guestInputSchema,
  type GuestListQuery,
  guestListQuerySchema,
} from './schemas';

export type GuestRow = typeof guests.$inferSelect;

/** Another guest of the same event with the same number, as shown in the duplicate warning. */
export interface DuplicateGuest {
  id: string;
  fullName: string;
  phoneE164: string | null;
  groupName: string | null;
  status: 'active' | 'cancelled';
}

/** Guests of the event with this normalized phone (excluding `exceptId`). */
export async function findDuplicates(
  db: DbOrTx,
  eventId: string,
  phoneE164: string,
  exceptId?: string,
): Promise<DuplicateGuest[]> {
  return db
    .select({
      id: guests.id,
      fullName: guests.fullName,
      phoneE164: guests.phoneE164,
      groupName: guestGroups.name,
      status: guests.status,
    })
    .from(guests)
    .leftJoin(guestGroups, eq(guestGroups.id, guests.groupId))
    .where(
      and(
        eq(guests.eventId, eventId),
        eq(guests.phoneE164, phoneE164),
        isNull(guests.anonymizedAt),
        exceptId ? ne(guests.id, exceptId) : undefined,
      ),
    )
    .orderBy(asc(guests.createdAt))
    .limit(5);
}

async function assertGroup(db: DbOrTx, eventId: string, groupId: string | null | undefined) {
  if (!groupId) return;
  const [g] = await db
    .select({ id: guestGroups.id })
    .from(guestGroups)
    .where(and(eq(guestGroups.eventId, eventId), eq(guestGroups.id, groupId)));
  if (!g) {
    throw new DomainError('validation_failed', 'Unknown group', {
      fields: { groupId: 'not_found' },
    });
  }
}

/** Loads one guest of the event and locks its row for the rest of the transaction. */
async function lockGuest(db: DbOrTx, eventId: string, guestId: string): Promise<GuestRow> {
  const [g] = await db
    .select()
    .from(guests)
    .where(and(eq(guests.eventId, eventId), eq(guests.id, guestId)))
    .for('update');
  if (!g) throw new DomainError('not_found');
  return g;
}

export type SaveGuestResult =
  { status: 'saved'; guestId: string } | { status: 'duplicate'; duplicates: DuplicateGuest[] };

/**
 * Adds a guest by hand. A guest with the same phone is a warning, not a block: the first call
 * returns the matches, and saving again with `allowDuplicate` records that the owner chose to.
 */
export async function addGuest(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  input: unknown,
): Promise<SaveGuestResult> {
  const data = parseInput(guestInputSchema, input);
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    await assertGroup(tx, eventId, data.groupId);
    const duplicates = await findDuplicates(tx, eventId, data.phone.e164);
    if (duplicates.length > 0 && !data.allowDuplicate) return { status: 'duplicate', duplicates };

    const id = newId();
    const now = ctx.now();
    await tx.insert(guests).values({
      id,
      eventId,
      groupId: data.groupId ?? null,
      fullName: data.fullName,
      nameSearch: searchForm(data.fullName),
      phoneOriginal: data.phone.original,
      phoneE164: data.phone.e164,
      email: data.email ?? null,
      allowedCompanions: data.allowedCompanions ?? event.defaultAllowedCompanions,
      notes: data.notes ?? null,
      source: 'manual',
      createdByMembershipId: actor.membershipId,
      createdAt: now,
      updatedAt: now,
    });
    const lifecycle = await createGuestLifecycle(tx, [{ id, eventId }], {
      actor,
      workspaceId: event.workspaceId,
      now,
    });
    await recordActivities(tx, [
      {
        type: 'guest.created',
        actor,
        eventId,
        workspaceId: event.workspaceId,
        guestId: id,
        data: { source: 'manual', duplicateAcknowledged: duplicates.length > 0 },
      },
      ...lifecycle,
    ]);
    return { status: 'saved', guestId: id };
  });
}

/** Field names only, in the order the edit form shows them. Values stay out of activity. */
type EditField = 'fullName' | 'phone' | 'email' | 'notes';

/**
 * Edits a guest. Activity records which fields changed (never their values), plus separate
 * entries for a group move and a companion allowance change. Changing the phone to one another
 * guest has triggers the same warning as adding.
 */
export async function updateGuest(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
  input: unknown,
): Promise<SaveGuestResult & { changed?: boolean }> {
  const data: GuestInput = parseInput(guestInputSchema, input);
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    const g = await lockGuest(tx, eventId, guestId);
    if (g.anonymizedAt) throw new DomainError('not_found');
    await assertGroup(tx, eventId, data.groupId);

    const next = {
      fullName: data.fullName,
      phoneOriginal: data.phone.original,
      phoneE164: data.phone.e164,
      email: data.email ?? null,
      notes: data.notes ?? null,
      groupId: data.groupId ?? null,
      allowedCompanions: data.allowedCompanions ?? g.allowedCompanions,
    };
    const changed: EditField[] = [];
    if (next.fullName !== g.fullName) changed.push('fullName');
    if (next.phoneE164 !== g.phoneE164 || next.phoneOriginal !== g.phoneOriginal)
      changed.push('phone');
    if ((next.email ?? '').toLowerCase() !== (g.email ?? '').toLowerCase()) changed.push('email');
    if (next.notes !== g.notes) changed.push('notes');
    const groupChanged = next.groupId !== g.groupId;
    const companionsChanged = next.allowedCompanions !== g.allowedCompanions;
    if (!changed.length && !groupChanged && !companionsChanged) {
      return { status: 'saved', guestId, changed: false };
    }

    if (companionsChanged)
      await assertAllowanceCoversAnswers(tx, [guestId], next.allowedCompanions);

    let duplicateAcknowledged = false;
    if (next.phoneE164 !== g.phoneE164) {
      const duplicates = await findDuplicates(tx, eventId, next.phoneE164, guestId);
      if (duplicates.length > 0 && !data.allowDuplicate) return { status: 'duplicate', duplicates };
      duplicateAcknowledged = duplicates.length > 0;
    }

    await tx
      .update(guests)
      .set({ ...next, nameSearch: searchForm(next.fullName), updatedAt: ctx.now() })
      .where(eq(guests.id, guestId));

    const base = { actor, eventId, workspaceId: event.workspaceId, guestId };
    const entries: ActivityInput[] = [];
    if (changed.length) {
      entries.push({
        ...base,
        type: 'guest.updated',
        data: { fields: changed, ...(duplicateAcknowledged ? { duplicateAcknowledged } : {}) },
      });
    }
    if (groupChanged) {
      entries.push({
        ...base,
        type: 'guest.group_changed',
        data: { from: g.groupId, to: next.groupId },
      });
    }
    if (companionsChanged) {
      entries.push({
        ...base,
        type: 'guest.companion_allowance_changed',
        data: { from: g.allowedCompanions, to: next.allowedCompanions },
      });
    }
    await recordActivities(tx, entries);
    return { status: 'saved', guestId, changed: true };
  });
}

/**
 * Cancels a guest: they stay on the list (and in search) as cancelled, nothing is deleted.
 * The reason is optional; it is shown to the owner only and never recorded in activity.
 */
export async function cancelGuest(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
  input: unknown = {},
) {
  const { reason } = parseInput(cancelInputSchema, input);
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    const g = await lockGuest(tx, eventId, guestId);
    if (g.status === 'cancelled') return { changed: false };
    const now = ctx.now();
    await tx
      .update(guests)
      .set({ status: 'cancelled', cancelledAt: now, cancelReason: reason || null, updatedAt: now })
      .where(eq(guests.id, guestId));
    const revoked = await revokeActivePass(tx, g, 'guest_cancelled', {
      actor,
      workspaceId: event.workspaceId,
      now,
    });
    await recordActivities(tx, [
      {
        type: 'guest.cancelled',
        actor,
        eventId,
        workspaceId: event.workspaceId,
        guestId,
        data: { withReason: Boolean(reason) },
      },
      ...(revoked.activity ? [revoked.activity] : []),
    ]);
    return { changed: true };
  });
}

/** Restores a cancelled guest to active. The cancellation stays in the guest's timeline. */
export async function restoreGuest(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
) {
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    const g = await lockGuest(tx, eventId, guestId);
    if (g.status === 'active') return { changed: false };
    const now = ctx.now();
    await tx
      .update(guests)
      .set({ status: 'active', cancelledAt: null, cancelReason: null, updatedAt: now })
      .where(eq(guests.id, guestId));
    const entries: ActivityInput[] = [
      { type: 'guest.restored', actor, eventId, workspaceId: event.workspaceId, guestId },
    ];
    // The old pass stays revoked. A guest who had confirmed gets a new pass with a new token.
    const [answer] = await tx
      .select({ status: rsvps.status })
      .from(rsvps)
      .where(eq(rsvps.guestId, guestId));
    if (answer?.status === 'confirmed') {
      const issued = await issuePass(tx, g, 'restored', {
        actor,
        workspaceId: event.workspaceId,
        now,
      });
      entries.push(issued.activity);
    }
    await recordActivities(tx, entries);
    return { changed: true };
  });
}

export type HardDeleteBlock =
  'invitation_shared' | 'invitation_opened' | 'responded' | 'checked_in';

/**
 * The one place that decides whether a guest may be removed outright rather than cancelled.
 * Once the invitation has left the platform (shared or opened) or the guest has answered, the
 * guest can only be cancelled, so their history stays. Phase 4 adds "checked in".
 */
export async function canHardDeleteGuest(
  db: DbOrTx,
  guest: GuestRow,
): Promise<{ allowed: true } | { allowed: false; reason: HardDeleteBlock }> {
  const [row] = await db
    .select({
      shareCount: invitations.shareCount,
      openedAt: invitations.openedAt,
      rsvp: rsvps.status,
    })
    .from(guests)
    .leftJoin(invitations, eq(invitations.guestId, guests.id))
    .leftJoin(rsvps, eq(rsvps.guestId, guests.id))
    .where(eq(guests.id, guest.id));
  if (row?.openedAt) return { allowed: false, reason: 'invitation_opened' };
  if ((row?.shareCount ?? 0) > 0) return { allowed: false, reason: 'invitation_shared' };
  if (row?.rsvp && row.rsvp !== 'pending') return { allowed: false, reason: 'responded' };
  return { allowed: true };
}

/** Lowering an allowance below what a guest already confirmed would break their answer. */
async function assertAllowanceCoversAnswers(tx: DbOrTx, guestIds: string[], allowance: number) {
  const [over] = await tx
    .select({ n: count() })
    .from(rsvps)
    .where(and(inArray(rsvps.guestId, guestIds), gt(rsvps.companionCount, allowance)));
  if (Number(over?.n ?? 0) > 0) {
    throw new DomainError('allowance_below_response', undefined, {
      guests: Number(over!.n),
      fields: { allowedCompanions: 'below_response' },
    });
  }
}

/**
 * Permanently removes a guest who was added by mistake. Activity keeps the guest id (never the
 * name or phone) so the event's history still shows that a guest was deleted.
 */
export async function deleteGuest(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
) {
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    const g = await lockGuest(tx, eventId, guestId);
    const rule = await canHardDeleteGuest(tx, g);
    if (!rule.allowed) {
      throw new DomainError('guest_delete_not_allowed', undefined, { reason: rule.reason });
    }
    await tx.delete(guests).where(eq(guests.id, guestId));
    await recordActivity(tx, {
      type: 'guest.deleted',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      guestId,
      data: { source: g.source, status: g.status },
    });
    return { deleted: true };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Reading                                                                                    */
/* ------------------------------------------------------------------------------------------ */

function listFilters(eventId: string, query: GuestListQuery): SQL | undefined {
  const where: (SQL | undefined)[] = [eq(guests.eventId, eventId), isNull(guests.anonymizedAt)];
  if (query.status !== 'all') where.push(eq(guests.status, query.status));
  if (query.source !== 'all') where.push(eq(guests.source, query.source));
  if (query.group === 'none') where.push(isNull(guests.groupId));
  else if (query.group !== 'all') where.push(eq(guests.groupId, query.group));
  if (query.rsvp !== 'all') where.push(eq(rsvps.status, query.rsvp));
  if (query.invite === 'not_shared')
    where.push(eq(invitations.shareCount, 0), isNull(invitations.openedAt));
  if (query.invite === 'shared')
    where.push(gt(invitations.shareCount, 0), isNull(invitations.openedAt));
  if (query.invite === 'opened') where.push(sql`${invitations.openedAt} IS NOT NULL`);

  const q = query.q.trim();
  if (q) {
    const name = searchForm(q);
    const digits = phoneSearchDigits(q);
    const byName = name ? sql`${guests.nameSearch} LIKE ${`%${escapeLike(name)}%`}` : undefined;
    const byPhone = digits ? sql`${guests.phoneE164} LIKE ${`%${digits}%`}` : undefined;
    where.push(
      byName && byPhone ? sql`(${byName} OR ${byPhone})` : (byName ?? byPhone ?? sql`false`),
    );
  }
  return and(...where);
}

export interface GuestListItem {
  id: string;
  fullName: string;
  phoneE164: string | null;
  groupId: string | null;
  groupName: string | null;
  allowedCompanions: number;
  source: GuestRow['source'];
  status: GuestRow['status'];
  createdAt: Date;
  rsvpStatus: 'pending' | 'confirmed' | 'declined';
  companionCount: number;
  shareCount: number;
  openedAt: Date | null;
}

/** One page of the guest list with filters, search and sorting applied on the database. */
export async function listGuests(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  rawQuery: unknown = {},
): Promise<{
  rows: GuestListItem[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}> {
  await requireGuestView(ctx.db, userId, eventId);
  const query = guestListQuerySchema.parse(rawQuery);
  const where = listFilters(eventId, query);
  const [{ total }] = (await ctx.db
    .select({ total: count() })
    .from(guests)
    .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
    .innerJoin(invitations, eq(invitations.guestId, guests.id))
    .where(where)) as [{ total: number }];
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  const page = Math.min(query.page, pages);
  const order =
    query.sort === 'name'
      ? [asc(guests.nameSearch), asc(guests.id)]
      : query.sort === 'oldest'
        ? [asc(guests.createdAt), asc(guests.id)]
        : [desc(guests.createdAt), desc(guests.id)];
  const rows = await ctx.db
    .select({
      id: guests.id,
      fullName: guests.fullName,
      phoneE164: guests.phoneE164,
      groupId: guests.groupId,
      groupName: guestGroups.name,
      allowedCompanions: guests.allowedCompanions,
      source: guests.source,
      status: guests.status,
      createdAt: guests.createdAt,
      rsvpStatus: rsvps.status,
      companionCount: rsvps.companionCount,
      shareCount: invitations.shareCount,
      openedAt: invitations.openedAt,
    })
    .from(guests)
    .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
    .innerJoin(invitations, eq(invitations.guestId, guests.id))
    .leftJoin(guestGroups, eq(guestGroups.id, guests.groupId))
    .where(where)
    .orderBy(...order)
    .limit(query.pageSize)
    .offset((page - 1) * query.pageSize);
  return { rows, total, page, pageSize: query.pageSize, pages };
}

export interface GuestSummary {
  total: number;
  active: number;
  cancelled: number;
  /** Active guests plus the companions they may bring: the most people who could come. */
  potentialCapacity: number;
}

/** Counts for the summary strip and the overview. Not RSVP or attendance. */
export async function guestSummaryFor(db: DbOrTx, eventId: string): Promise<GuestSummary> {
  const [row] = await db
    .select({
      total: count(),
      active: sql<number>`count(*) FILTER (WHERE ${guests.status} = 'active')`.mapWith(Number),
      cancelled: sql<number>`count(*) FILTER (WHERE ${guests.status} = 'cancelled')`.mapWith(
        Number,
      ),
      potentialCapacity:
        sql<number>`coalesce(sum(1 + ${guests.allowedCompanions}) FILTER (WHERE ${guests.status} = 'active'), 0)`.mapWith(
          Number,
        ),
    })
    .from(guests)
    .where(and(eq(guests.eventId, eventId), isNull(guests.anonymizedAt)));
  return row ?? { total: 0, active: 0, cancelled: 0, potentialCapacity: 0 };
}

export async function guestSummary(ctx: CoreContext, userId: string, eventId: string) {
  await requireGuestView(ctx.db, userId, eventId);
  return guestSummaryFor(ctx.db, eventId);
}

export async function getGuest(ctx: CoreContext, userId: string, eventId: string, guestId: string) {
  await requireGuestView(ctx.db, userId, eventId);
  const [row] = await ctx.db
    .select({ guest: guests, groupName: guestGroups.name, addedBy: eventMemberships.displayName })
    .from(guests)
    .leftJoin(guestGroups, eq(guestGroups.id, guests.groupId))
    .leftJoin(eventMemberships, eq(eventMemberships.id, guests.createdByMembershipId))
    .where(and(eq(guests.eventId, eventId), eq(guests.id, guestId), isNull(guests.anonymizedAt)));
  if (!row) throw new DomainError('not_found');
  return { ...row.guest, groupName: row.groupName, addedBy: row.addedBy };
}

export interface GuestActivityItem {
  id: number;
  type: string;
  at: Date;
  byName: string | null;
  bySchedule: boolean;
  /** The guest acted themselves, through their invitation link. */
  byGuest: boolean;
  data: Record<string, unknown>;
}

/**
 * A guest's timeline, newest first, a page at a time (`before` is the last id seen). Group ids
 * in the entries are resolved to the groups' current names by the caller.
 */
export async function listGuestActivity(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
  opts: { before?: number; limit?: number } = {},
): Promise<{ items: GuestActivityItem[]; more: boolean }> {
  await requireGuestView(ctx.db, userId, eventId);
  const limit = Math.min(opts.limit ?? 20, 200);
  const rows = await ctx.db
    .select({
      id: activity.id,
      type: activity.type,
      at: activity.createdAt,
      actorType: activity.actorType,
      byName: eventMemberships.displayName,
      data: activity.data,
    })
    .from(activity)
    .leftJoin(eventMemberships, eq(eventMemberships.id, activity.actorMembershipId))
    .where(
      and(
        eq(activity.eventId, eventId),
        eq(activity.guestId, guestId),
        opts.before ? lt(activity.id, opts.before) : undefined,
      ),
    )
    .orderBy(desc(activity.id))
    .limit(limit + 1);
  return {
    items: rows.slice(0, limit).map((r) => ({
      id: r.id,
      type: r.type,
      at: r.at,
      byName: r.byName,
      bySchedule: r.actorType === 'system',
      byGuest: r.actorType === 'guest',
      data: (r.data ?? {}) as Record<string, unknown>,
    })),
    more: rows.length > limit,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Bulk actions: all-or-nothing, one activity entry per guest that actually changed           */
/* ------------------------------------------------------------------------------------------ */

async function lockSelection(tx: DbOrTx, eventId: string, ids: string[]): Promise<GuestRow[]> {
  const rows = await tx
    .select()
    .from(guests)
    .where(and(eq(guests.eventId, eventId), inArray(guests.id, ids), isNull(guests.anonymizedAt)))
    .orderBy(asc(guests.id))
    .for('update');
  // Every selected guest must belong to this event; otherwise nothing changes.
  if (rows.length !== ids.length) throw new DomainError('not_found');
  return rows;
}

async function bulk(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  rawIds: unknown,
  apply: (
    tx: DbOrTx,
    access: EventAccess,
    selected: GuestRow[],
    now: Date,
  ) => Promise<ActivityInput[]>,
) {
  const ids = parseIds(rawIds);
  return ctx.db.transaction(async (tx) => {
    const access = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    const selected = await lockSelection(tx, eventId, ids);
    const entries = await apply(tx, access, selected, ctx.now());
    await recordActivities(tx, entries);
    // Pass revocations ride along with cancellations; they are not extra guests changed.
    return {
      selected: selected.length,
      changed: entries.filter((e) => !e.type.startsWith('pass.')).length,
    };
  });
}

function parseIds(raw: unknown): string[] {
  const result = guestIdsSchema.safeParse(raw);
  if (!result.success) {
    const tooMany = result.error.issues.some((i) => i.message === 'too_many_selected');
    throw new DomainError(tooMany ? 'too_many_selected' : 'validation_failed');
  }
  return result.data;
}

export async function bulkAssignGroup(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestIds: unknown,
  groupId: string | null,
) {
  return bulk(ctx, userId, eventId, guestIds, async (tx, { event, actor }, selected, now) => {
    await assertGroup(tx, eventId, groupId);
    const moving = selected.filter((g) => g.groupId !== groupId);
    if (moving.length) {
      await tx
        .update(guests)
        .set({ groupId, updatedAt: now })
        .where(
          inArray(
            guests.id,
            moving.map((g) => g.id),
          ),
        );
    }
    return moving.map((g) => ({
      type: 'guest.group_changed' as const,
      actor,
      eventId,
      workspaceId: event.workspaceId,
      guestId: g.id,
      data: { from: g.groupId, to: groupId, bulk: true },
    }));
  });
}

export async function bulkCancel(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestIds: unknown,
  input: unknown = {},
) {
  const { reason } = parseInput(cancelInputSchema, input);
  return bulk(ctx, userId, eventId, guestIds, async (tx, { event, actor }, selected, now) => {
    const active = selected.filter((g) => g.status === 'active');
    if (active.length) {
      await tx
        .update(guests)
        .set({
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: reason || null,
          updatedAt: now,
        })
        .where(
          inArray(
            guests.id,
            active.map((g) => g.id),
          ),
        );
    }
    const revoked = await revokeActivePasses(
      tx,
      eventId,
      active.map((g) => g.id),
      'guest_cancelled',
      { actor, workspaceId: event.workspaceId, now },
    );
    return [
      ...active.map((g) => ({
        type: 'guest.cancelled' as const,
        actor,
        eventId,
        workspaceId: event.workspaceId,
        guestId: g.id,
        data: { withReason: Boolean(reason), bulk: true },
      })),
      ...revoked,
    ];
  });
}

export async function bulkSetCompanions(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestIds: unknown,
  rawCompanions: unknown,
) {
  const parsed = companionsSchema.safeParse(rawCompanions);
  if (!parsed.success) {
    throw new DomainError('validation_failed', undefined, {
      fields: { allowedCompanions: 'out_of_range' },
    });
  }
  const to = parsed.data;
  return bulk(ctx, userId, eventId, guestIds, async (tx, { event, actor }, selected, now) => {
    const changing = selected.filter((g) => g.allowedCompanions !== to);
    if (changing.length) {
      await assertAllowanceCoversAnswers(
        tx,
        changing.map((g) => g.id),
        to,
      );
      await tx
        .update(guests)
        .set({ allowedCompanions: to, updatedAt: now })
        .where(
          inArray(
            guests.id,
            changing.map((g) => g.id),
          ),
        );
    }
    return changing.map((g) => ({
      type: 'guest.companion_allowance_changed' as const,
      actor,
      eventId,
      workspaceId: event.workspaceId,
      guestId: g.id,
      data: { from: g.allowedCompanions, to, bulk: true },
    }));
  });
}
