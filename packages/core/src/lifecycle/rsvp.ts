import { events, guests, invitations, rsvps } from '@gp/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type ActivityInput, type Actor, recordActivities } from '../activity/activity';
import { checkedInCount } from '../checkin/count';
import { requireEventAccess } from '../authorization/authorization';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { isPublicToken, publicTokenHash } from '../shared/tokens';
import { parseInput } from '../shared/validation';
import { MAX_COMPANIONS } from '../guests/schemas';
import { activePass, issuePass, type PassRow, replaceActivePass, revokeActivePass } from './passes';
import { invitationPageState, rsvpOpen } from './state';

export type RsvpRow = typeof rsvps.$inferSelect;
type GuestRow = typeof guests.$inferSelect;
type EventRow = typeof events.$inferSelect;

const formInt = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);

/** An answer: confirmed with a companion count, or declined. There is no way back to pending. */
export const rsvpInputSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('confirmed'),
    companions: z.preprocess(
      (v) => (v === undefined || v === '' ? 0 : formInt(v)),
      z
        .number({ message: 'out_of_range' })
        .int({ message: 'out_of_range' })
        .min(0, { message: 'out_of_range' })
        .max(MAX_COMPANIONS, { message: 'out_of_range' }),
    ),
  }),
  z.object({ status: z.literal('declined') }),
]);
export type RsvpInput = z.infer<typeof rsvpInputSchema>;

export interface RsvpOutcome {
  /** False when the answer was already exactly this (a repeated submit): nothing was written. */
  changed: boolean;
  rsvp: RsvpRow;
  pass: PassRow | null;
}

/**
 * Applies an answer to a guest whose row the caller has locked. One code path for the guest and
 * the owner, so passes and history follow the same rules:
 *   pending/declined → confirmed   saves the answer and issues a new pass (never an old token)
 *   confirmed → confirmed          only the companion count changes; the pass stays
 *   pending/confirmed → declined   companions go to 0 and the active pass is revoked
 * Repeating the current answer changes nothing and records nothing.
 */
export async function applyRsvp(
  tx: DbOrTx,
  target: { event: EventRow; guest: GuestRow; rsvp: RsvpRow },
  input: RsvpInput,
  actor: Actor,
  now: Date,
  key: Buffer,
): Promise<RsvpOutcome> {
  const { event, guest, rsvp } = target;
  const companions = input.status === 'confirmed' ? input.companions : 0;
  if (companions > guest.allowedCompanions) {
    throw new DomainError('companions_over_allowance', undefined, {
      allowed: guest.allowedCompanions,
    });
  }
  if (rsvp.status === input.status && rsvp.companionCount === companions) {
    return { changed: false, rsvp, pass: await activePass(tx, guest.id) };
  }

  const [saved] = await tx
    .update(rsvps)
    .set({
      status: input.status,
      companionCount: companions,
      respondedAt: now,
      lastActorType: actor.type === 'guest' ? 'guest' : 'member',
      lastActorMembershipId: actor.type === 'member' ? actor.membershipId : null,
      updatedAt: now,
    })
    .where(eq(rsvps.id, rsvp.id))
    .returning();

  const scope = { actor, workspaceId: event.workspaceId, now, key };
  const base = { actor, eventId: event.id, workspaceId: event.workspaceId, guestId: guest.id };
  const entries: ActivityInput[] = [];
  let pass: PassRow | null;

  if (input.status === 'declined') {
    entries.push({ ...base, type: 'rsvp.declined', data: { from: rsvp.status } });
    const revoked = await revokeActivePass(tx, guest, 'declined', scope);
    if (revoked.activity) entries.push(revoked.activity);
    pass = null;
  } else if (rsvp.status === 'confirmed') {
    entries.push({
      ...base,
      type: 'rsvp.changed',
      data: { fromCompanions: rsvp.companionCount, toCompanions: companions },
    });
    pass = await activePass(tx, guest.id);
  } else {
    entries.push({
      ...base,
      type: 'rsvp.confirmed',
      data: { from: rsvp.status, companions },
    });
    // Normally there is no active pass here; revoke defensively so there is only ever one.
    const stale = await revokeActivePass(tx, guest, 'replaced', scope);
    if (stale.activity) entries.push(stale.activity);
    const issued = await issuePass(tx, guest, 'confirmed', scope);
    entries.push(issued.activity);
    pass = issued.pass;
  }
  await recordActivities(tx, entries);
  return { changed: true, rsvp: saved!, pass };
}

async function lockGuestAndRsvp(tx: DbOrTx, eventId: string, guestId: string) {
  const [guest] = await tx
    .select()
    .from(guests)
    .where(and(eq(guests.eventId, eventId), eq(guests.id, guestId)))
    .for('update');
  if (!guest || guest.anonymizedAt) throw new DomainError('not_found');
  const [rsvp] = await tx.select().from(rsvps).where(eq(rsvps.guestId, guestId));
  if (!rsvp) throw new DomainError('not_found');
  return { guest, rsvp };
}

/**
 * The guest answers through their link. The event row is share-locked so a cancellation or
 * completion waits for this answer (and the answer after it sees the new state); the guest row
 * lock serializes two tabs, the owner, and anything else touching this guest.
 */
export async function respondToInvitation(
  ctx: CoreContext,
  token: string,
  rawInput: unknown,
): Promise<RsvpOutcome> {
  if (!isPublicToken(token)) throw new DomainError('not_found');
  const input = parseInput(rsvpInputSchema, rawInput);
  return ctx.db.transaction(async (tx) => {
    const [inv] = await tx
      .select({ id: invitations.id, eventId: invitations.eventId, guestId: invitations.guestId })
      .from(invitations)
      .where(eq(invitations.tokenHash, publicTokenHash(token)));
    if (!inv) throw new DomainError('not_found');
    const [event] = await tx.select().from(events).where(eq(events.id, inv.eventId)).for('share');
    if (!event) throw new DomainError('not_found');
    const { guest, rsvp } = await lockGuestAndRsvp(tx, inv.eventId, inv.guestId);
    // The token may have been rotated between the lookup and the lock.
    const [still] = await tx
      .select({ id: invitations.id })
      .from(invitations)
      .where(and(eq(invitations.id, inv.id), eq(invitations.tokenHash, publicTokenHash(token))));
    if (!still) throw new DomainError('not_found');

    const state = invitationPageState(event, guest);
    if (state !== 'open') {
      throw new DomainError(guest.status !== 'active' ? 'guest_not_active' : 'rsvp_closed');
    }
    // Once anyone in the party is inside, the guest's own answer is fixed; the owner can still
    // change it (never below the people already inside).
    if ((await checkedInCount(tx, guest.id)) > 0) throw new DomainError('rsvp_locked_checked_in');
    const now = ctx.now();
    const outcome = await applyRsvp(
      tx,
      { event, guest, rsvp },
      input,
      { type: 'guest' },
      now,
      ctx.encryptionKey,
    );
    // Answering proves the guest opened the page, even if the open beacon never ran.
    await markOpened(tx, { id: inv.id, eventId: event.id, guestId: guest.id }, event, now);
    return outcome;
  });
}

/** Counts a page open. Opens within 30 minutes of the last one are the same visit. */
export const OPEN_VISIT_GAP_MS = 30 * 60_000;

export async function markOpened(
  tx: DbOrTx,
  inv: { id: string; eventId: string; guestId: string },
  event: EventRow,
  now: Date,
): Promise<'first' | 'again' | 'same_visit'> {
  const [row] = await tx
    .select({ openedAt: invitations.openedAt, lastOpenedAt: invitations.lastOpenedAt })
    .from(invitations)
    .where(eq(invitations.id, inv.id))
    .for('update');
  if (!row) return 'same_visit';
  if (row.lastOpenedAt && now.getTime() - row.lastOpenedAt.getTime() < OPEN_VISIT_GAP_MS) {
    await tx.update(invitations).set({ lastOpenedAt: now }).where(eq(invitations.id, inv.id));
    return 'same_visit';
  }
  const first = row.openedAt === null;
  await tx
    .update(invitations)
    .set({
      openedAt: row.openedAt ?? now,
      lastOpenedAt: now,
      openCount: sql`${invitations.openCount} + 1`,
      updatedAt: now,
    })
    .where(eq(invitations.id, inv.id));
  if (first) {
    await recordActivities(tx, [
      {
        type: 'invitation.opened',
        actor: { type: 'guest' },
        eventId: inv.eventId,
        workspaceId: event.workspaceId,
        guestId: inv.guestId,
      },
    ]);
  }
  return first ? 'first' : 'again';
}

/**
 * The owner records or changes a guest's answer from the drawer (for example after a phone
 * call). History names the owner's membership, never the guest.
 */
export async function setGuestRsvp(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
  rawInput: unknown,
): Promise<RsvpOutcome> {
  const input = parseInput(rsvpInputSchema, rawInput);
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireEventAccess(tx, userId, eventId, 'rsvp.manage', {
      forShare: true,
    });
    if (!rsvpOpen(event)) throw new DomainError('rsvp_closed', undefined, { status: event.status });
    const { guest, rsvp } = await lockGuestAndRsvp(tx, eventId, guestId);
    if (guest.status !== 'active') throw new DomainError('guest_not_active');
    const inside = await checkedInCount(tx, guest.id);
    const party = input.status === 'confirmed' ? 1 + input.companions : 0;
    if (party < inside) {
      throw new DomainError('party_below_checked_in', undefined, { checkedIn: inside });
    }
    return applyRsvp(tx, { event, guest, rsvp }, input, actor, ctx.now(), ctx.encryptionKey);
  });
}

/** Revokes the active pass and issues a new one (the old QR stops working). */
export async function replaceGuestPass(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
): Promise<PassRow> {
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireEventAccess(tx, userId, eventId, 'rsvp.manage', {
      forShare: true,
    });
    if (!rsvpOpen(event)) throw new DomainError('rsvp_closed', undefined, { status: event.status });
    const { guest } = await lockGuestAndRsvp(tx, eventId, guestId);
    const replaced = await replaceActivePass(tx, guest, {
      actor,
      workspaceId: event.workspaceId,
      now: ctx.now(),
      key: ctx.encryptionKey,
    });
    if (!replaced) throw new DomainError('no_active_pass');
    await recordActivities(tx, replaced.activities);
    return replaced.pass;
  });
}
