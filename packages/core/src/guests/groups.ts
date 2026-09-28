import { guestGroups, guests } from '@gp/db/schema';
import { and, asc, count, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordActivities, recordActivity } from '../activity/activity';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import { cleanText } from '../shared/text';
import { parseInput } from '../shared/validation';
import { requireGuestManagement, requireGuestView } from './access';

export const MAX_GROUPS_PER_EVENT = 50;

export const groupNameSchema = z.object({
  name: z
    .string({ message: 'required' })
    .transform(cleanText)
    .pipe(z.string().min(1, { message: 'required' }).max(60, { message: 'too_long' })),
});

/** Case-insensitive key used to match group names (also by the import). */
export function groupKey(name: string): string {
  return cleanText(name).toLowerCase();
}

async function nameTaken(db: DbOrTx, eventId: string, name: string, exceptId?: string) {
  const [row] = await db
    .select({ id: guestGroups.id })
    .from(guestGroups)
    .where(
      and(
        eq(guestGroups.eventId, eventId),
        sql`lower(${guestGroups.name}) = ${groupKey(name)}`,
        exceptId ? sql`${guestGroups.id} <> ${exceptId}` : undefined,
      ),
    );
  return Boolean(row);
}

export async function listGroups(ctx: CoreContext, userId: string, eventId: string) {
  await requireGuestView(ctx.db, userId, eventId);
  return ctx.db
    .select({
      id: guestGroups.id,
      name: guestGroups.name,
      sortOrder: guestGroups.sortOrder,
      guestCount:
        sql<number>`count(${guests.id}) FILTER (WHERE ${guests.status} = 'active')`.mapWith(Number),
    })
    .from(guestGroups)
    .leftJoin(guests, eq(guests.groupId, guestGroups.id))
    .where(eq(guestGroups.eventId, eventId))
    .groupBy(guestGroups.id)
    .orderBy(asc(guestGroups.sortOrder), asc(guestGroups.createdAt));
}

/** Inserts a group; the caller holds the event lock. Used by createGroup and the import. */
export async function insertGroup(
  tx: DbOrTx,
  eventId: string,
  name: string,
  now: Date,
): Promise<string> {
  const [{ n, max }] = (await tx
    .select({ n: count(), max: sql<number>`coalesce(max(${guestGroups.sortOrder}), 0)` })
    .from(guestGroups)
    .where(eq(guestGroups.eventId, eventId))) as [{ n: number; max: number }];
  if (n >= MAX_GROUPS_PER_EVENT) throw new DomainError('too_many_groups');
  const id = newId();
  await tx.insert(guestGroups).values({
    id,
    eventId,
    name,
    sortOrder: Number(max) + 1,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

export async function createGroup(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  input: unknown,
) {
  const { name } = parseInput(groupNameSchema, input);
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    if (await nameTaken(tx, eventId, name)) {
      throw new DomainError('group_name_taken', undefined, {
        fields: { name: 'group_name_taken' },
      });
    }
    const groupId = await insertGroup(tx, eventId, name, ctx.now());
    await recordActivity(tx, {
      type: 'guest_group.created',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { groupId },
    });
    return { groupId };
  });
}

async function loadGroup(db: DbOrTx, eventId: string, groupId: string) {
  const [group] = await db
    .select()
    .from(guestGroups)
    .where(and(eq(guestGroups.eventId, eventId), eq(guestGroups.id, groupId)));
  if (!group) throw new DomainError('not_found');
  return group;
}

export async function renameGroup(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  groupId: string,
  input: unknown,
) {
  const { name } = parseInput(groupNameSchema, input);
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    const group = await loadGroup(tx, eventId, groupId);
    if (group.name === name) return { changed: false };
    if (await nameTaken(tx, eventId, name, groupId)) {
      throw new DomainError('group_name_taken', undefined, {
        fields: { name: 'group_name_taken' },
      });
    }
    await tx
      .update(guestGroups)
      .set({ name, updatedAt: ctx.now() })
      .where(eq(guestGroups.id, groupId));
    await recordActivity(tx, {
      type: 'guest_group.renamed',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { groupId },
    });
    return { changed: true };
  });
}

/** Moves a group one place up or down in the list order. */
export async function moveGroup(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  groupId: string,
  direction: 'up' | 'down',
) {
  return ctx.db.transaction(async (tx) => {
    await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    const all = await tx
      .select({ id: guestGroups.id, sortOrder: guestGroups.sortOrder })
      .from(guestGroups)
      .where(eq(guestGroups.eventId, eventId))
      .orderBy(asc(guestGroups.sortOrder), asc(guestGroups.createdAt));
    const i = all.findIndex((g) => g.id === groupId);
    if (i === -1) throw new DomainError('not_found');
    const j = direction === 'up' ? i - 1 : i + 1;
    if (j < 0 || j >= all.length) return { changed: false };
    [all[i], all[j]] = [all[j]!, all[i]!];
    const now = ctx.now();
    // Renumber so equal or gapped orders never make the move a no-op.
    for (const [index, g] of all.entries()) {
      if (g.sortOrder !== index + 1) {
        await tx
          .update(guestGroups)
          .set({ sortOrder: index + 1, updatedAt: now })
          .where(eq(guestGroups.id, g.id));
      }
    }
    return { changed: true };
  });
}

/** Deletes a group. Its guests stay, with no group; each guest's timeline records the change. */
export async function deleteGroup(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  groupId: string,
) {
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    await loadGroup(tx, eventId, groupId);
    const now = ctx.now();
    const moved = await tx
      .update(guests)
      .set({ groupId: null, updatedAt: now })
      .where(and(eq(guests.eventId, eventId), eq(guests.groupId, groupId)))
      .returning({ id: guests.id });
    await tx.delete(guestGroups).where(eq(guestGroups.id, groupId));
    await recordActivities(tx, [
      {
        type: 'guest_group.deleted',
        actor,
        eventId,
        workspaceId: event.workspaceId,
        data: { groupId, guestCount: moved.length },
      },
      ...moved.map((g) => ({
        type: 'guest.group_changed' as const,
        actor,
        eventId,
        workspaceId: event.workspaceId,
        guestId: g.id,
        data: { from: groupId, to: null, reason: 'group_deleted' },
      })),
    ]);
    return { guestsUngrouped: moved.length };
  });
}
