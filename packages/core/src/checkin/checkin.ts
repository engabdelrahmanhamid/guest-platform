import {
  attendance,
  checkInLogs,
  eventMemberships,
  guestGroups,
  guestPasses,
  guests,
  rsvps,
} from '@gp/db/schema';
import { and, asc, desc, eq, gt, isNull, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { type ActivityInput, recordActivities } from '../activity/activity';
import type { EventRow } from '../authorization/authorization';
import { lifecycleTimes } from '../events/lifecycle';
import { findDuplicates, type DuplicateGuest } from '../guests/guests';
import { guestNameSchema, guestPhoneSchema, MAX_COMPANIONS } from '../guests/schemas';
import { createGuestLifecycle } from '../lifecycle/records';
import { applyRsvp } from '../lifecycle/rsvp';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import { phoneSearchDigits } from '../shared/phone';
import { escapeLike, searchForm } from '../shared/text';
import { isPublicToken, publicTokenHash } from '../shared/tokens';
import { parseInput } from '../shared/validation';
import { type DoorAccess, type DoorCaller, doorCan, requireDoorAccess } from './door';

/** The largest party one guest can bring: the guest plus the most companions allowed. */
export const MAX_PARTY = 1 + MAX_COMPANIONS;

export type AttendanceStatus = 'not_arrived' | 'partial' | 'complete';

export function attendanceStatus(checkedIn: number, expected: number): AttendanceStatus {
  if (checkedIn === 0) return 'not_arrived';
  return checkedIn < expected ? 'partial' : 'complete';
}

/** Why the door can't admit anyone for this guest right now (null: it can). */
export type DoorBlocker =
  | 'checkin_not_open'
  | 'guest_not_active'
  | 'not_confirmed'
  | 'rsvp_declined'
  | 'pass_revoked'
  | 'party_complete';

/**
 * One guest as the door sees it. Staff get the name, group, a masked phone, the party and the
 * counts; never the full phone, email or notes (approved data exposure for staff).
 */
export interface DoorGuest {
  guestId: string;
  name: string;
  group: string | null;
  maskedPhone: string | null;
  walkIn: boolean;
  guestStatus: 'active' | 'cancelled';
  rsvpStatus: 'pending' | 'confirmed' | 'declined';
  allowedCompanions: number;
  /** People expected: 1 + companions for an active, confirmed guest; otherwise 0. */
  expected: number;
  checkedIn: number;
  remaining: number;
  attendance: AttendanceStatus;
  last: { at: Date; by: string; count: number } | null;
  /** The pass the scanner read, when the lookup came from a QR. */
  scannedPass: { id: string; status: 'active' | 'revoked'; replaced: boolean } | null;
  activePassId: string | null;
  blocker: DoorBlocker | null;
  /** The caller may confirm this unanswered guest here (owner or supervisor, while live). */
  canConfirm: boolean;
  /** The caller may correct this guest's count (owner or supervisor). */
  canCorrect: boolean;
}

export function maskPhone(e164: string | null): string | null {
  return e164 ? `•••• ${e164.slice(-4)}` : null;
}

async function loadGuestRow(db: DbOrTx, eventId: string, guestId: string) {
  const [row] = await db
    .select({
      guest: guests,
      group: guestGroups.name,
      rsvp: rsvps,
      checkedIn: attendance.checkedInCount,
    })
    .from(guests)
    .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
    .leftJoin(guestGroups, eq(guestGroups.id, guests.groupId))
    .leftJoin(attendance, eq(attendance.guestId, guests.id))
    .where(and(eq(guests.eventId, eventId), eq(guests.id, guestId), isNull(guests.anonymizedAt)));
  return row ?? null;
}

async function lastArrival(db: DbOrTx, guestId: string) {
  const [row] = await db
    .select({
      at: checkInLogs.createdAt,
      by: eventMemberships.displayName,
      count: checkInLogs.countDelta,
    })
    .from(checkInLogs)
    .innerJoin(eventMemberships, eq(eventMemberships.id, checkInLogs.actorMembershipId))
    .where(and(eq(checkInLogs.guestId, guestId), gt(checkInLogs.countDelta, 0)))
    .orderBy(desc(checkInLogs.id))
    .limit(1);
  return row ?? null;
}

async function activePassId(db: DbOrTx, guestId: string): Promise<string | null> {
  const [p] = await db
    .select({ id: guestPasses.id })
    .from(guestPasses)
    .where(and(eq(guestPasses.guestId, guestId), eq(guestPasses.status, 'active')));
  return p?.id ?? null;
}

async function buildDoorGuest(
  db: DbOrTx,
  access: Pick<DoorAccess, 'event' | 'member'>,
  guestId: string,
  scanned: { id: string; status: 'active' | 'revoked'; replaced: boolean } | null = null,
  now: Date = new Date(),
): Promise<DoorGuest> {
  const row = await loadGuestRow(db, access.event.id, guestId);
  if (!row) throw new DomainError('not_found');
  const { guest, rsvp } = row;
  const expected =
    guest.status === 'active' && rsvp.status === 'confirmed' ? 1 + rsvp.companionCount : 0;
  const checkedIn = row.checkedIn ?? 0;
  const remaining = Math.max(0, expected - checkedIn);
  const [last, passId] = await Promise.all([lastArrival(db, guestId), activePassId(db, guestId)]);
  const live = access.event.status === 'live' && !access.event.disabledAt;
  let blocker: DoorBlocker | null = null;
  if (!live) blocker = 'checkin_not_open';
  else if (guest.status !== 'active') blocker = 'guest_not_active';
  else if (rsvp.status === 'pending') blocker = 'not_confirmed';
  else if (rsvp.status === 'declined') blocker = 'rsvp_declined';
  else if (scanned && scanned.status !== 'active') blocker = 'pass_revoked';
  else if (remaining === 0) blocker = 'party_complete';
  return {
    guestId: guest.id,
    name: guest.fullName,
    group: row.group,
    maskedPhone: maskPhone(guest.phoneE164),
    walkIn: guest.source === 'walk_in',
    guestStatus: guest.status,
    rsvpStatus: rsvp.status,
    allowedCompanions: guest.allowedCompanions,
    expected,
    checkedIn,
    remaining,
    attendance: attendanceStatus(checkedIn, expected),
    last,
    scannedPass: scanned,
    activePassId: passId,
    blocker,
    canConfirm:
      live &&
      guest.status === 'active' &&
      rsvp.status === 'pending' &&
      doorCan(access.member, 'confirm_rsvp'),
    canCorrect:
      doorCan(access.member, 'correct') && correctionOpen(access.event, access.member, now),
  };
}

/**
 * Corrections: the owner and supervisors while the event is live; the owner alone after it
 * completes, within the reopen window.
 */
export function correctionOpen(event: EventRow, member: DoorAccess['member'], now: Date): boolean {
  if (event.disabledAt) return false;
  if (event.status === 'live') return true;
  if (event.status === 'completed' && member.role === 'owner') {
    const { reopenUntil } = lifecycleTimes(event);
    return reopenUntil !== null && now.getTime() <= reopenUntil.getTime();
  }
  return false;
}

/* ------------------------------------------------------------------------------------------ */
/* Reading at the door                                                                        */
/* ------------------------------------------------------------------------------------------ */

export const QR_PREFIX = 'GP1.';

/** The pass token inside a scanned QR (`GP1.<token>`), or null for anything else. */
export function parseQrPayload(raw: string): string | null {
  const text = raw.trim();
  if (!text.startsWith(QR_PREFIX)) return null;
  const token = text.slice(QR_PREFIX.length);
  return isPublicToken(token) ? token : null;
}

export type QrLookup = { found: false } | { found: true; guest: DoorGuest };

/**
 * Resolves a scanned QR for this event. A pass of another event reads exactly like an unknown
 * code, so a scanner can't be used to probe other events.
 */
export async function lookupQr(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
  payload: string,
): Promise<QrLookup> {
  const access = await requireDoorAccess(ctx.db, caller, eventId, 'scan', { now: ctx.now() });
  const token = parseQrPayload(payload);
  if (!token) return { found: false };
  const [pass] = await ctx.db
    .select()
    .from(guestPasses)
    .where(
      and(eq(guestPasses.tokenHash, publicTokenHash(token)), eq(guestPasses.eventId, eventId)),
    );
  if (!pass) return { found: false };
  const guest = await buildDoorGuest(
    ctx.db,
    access,
    pass.guestId,
    {
      id: pass.id,
      status: pass.status,
      replaced: pass.revokeReason === 'replaced',
    },
    ctx.now(),
  );
  return { found: true, guest };
}

export async function getDoorGuest(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
  guestId: string,
): Promise<DoorGuest> {
  const access = await requireDoorAccess(ctx.db, caller, eventId, 'scan', { now: ctx.now() });
  return buildDoorGuest(ctx.db, access, guestId, null, ctx.now());
}

export interface DoorSearchRow {
  guestId: string;
  name: string;
  group: string | null;
  maskedPhone: string | null;
  walkIn: boolean;
  guestStatus: 'active' | 'cancelled';
  rsvpStatus: 'pending' | 'confirmed' | 'declined';
  expected: number;
  checkedIn: number;
  attendance: AttendanceStatus;
}

/** Manual search by name or phone digits; at most 20 rows, active guests first. */
export async function searchDoor(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
  query: string,
): Promise<DoorSearchRow[]> {
  await requireDoorAccess(ctx.db, caller, eventId, 'scan', { now: ctx.now() });
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const digits = phoneSearchDigits(q);
  const name = searchForm(q);
  const match: SQL | undefined = digits
    ? sql`${guests.phoneE164} LIKE ${`%${digits}%`}`
    : name.length >= 2
      ? sql`${guests.nameSearch} LIKE ${`%${escapeLike(name)}%`}`
      : undefined;
  if (!match) return [];
  const rows = await ctx.db
    .select({
      guest: guests,
      group: guestGroups.name,
      rsvpStatus: rsvps.status,
      companions: rsvps.companionCount,
      checkedIn: attendance.checkedInCount,
    })
    .from(guests)
    .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
    .leftJoin(guestGroups, eq(guestGroups.id, guests.groupId))
    .leftJoin(attendance, eq(attendance.guestId, guests.id))
    .where(and(eq(guests.eventId, eventId), isNull(guests.anonymizedAt), match))
    .orderBy(sql`${guests.status} = 'cancelled'`, asc(guests.nameSearch), asc(guests.id))
    .limit(20);
  return rows.map((r) => {
    const expected =
      r.guest.status === 'active' && r.rsvpStatus === 'confirmed' ? 1 + r.companions : 0;
    const checkedIn = r.checkedIn ?? 0;
    return {
      guestId: r.guest.id,
      name: r.guest.fullName,
      group: r.group,
      maskedPhone: maskPhone(r.guest.phoneE164),
      walkIn: r.guest.source === 'walk_in',
      guestStatus: r.guest.status,
      rsvpStatus: r.rsvpStatus,
      expected,
      checkedIn,
      attendance: attendanceStatus(checkedIn, expected),
    };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Writing at the door                                                                        */
/* ------------------------------------------------------------------------------------------ */

const idempotencyKeySchema = z.uuid({ message: 'invalid' });
const partyCount = z.coerce
  .number({ message: 'out_of_range' })
  .int({ message: 'out_of_range' })
  .min(1, { message: 'out_of_range' })
  .max(MAX_PARTY, { message: 'out_of_range' });

export const checkInSchema = z.object({
  guestId: z.uuid(),
  count: partyCount,
  method: z.enum(['qr', 'search']),
  passId: z.uuid().optional(),
  idempotencyKey: idempotencyKeySchema,
});

export const correctionSchema = z.object({
  guestId: z.uuid(),
  delta: z.coerce
    .number({ message: 'out_of_range' })
    .int({ message: 'out_of_range' })
    .min(-MAX_PARTY, { message: 'out_of_range' })
    .max(MAX_PARTY, { message: 'out_of_range' })
    .refine((n) => n !== 0, { message: 'out_of_range' }),
  reason: z
    .string({ message: 'required' })
    .trim()
    .min(1, { message: 'required' })
    .max(300, { message: 'too_long' }),
  idempotencyKey: idempotencyKeySchema,
});

export const walkInSchema = z.object({
  fullName: guestNameSchema,
  phone: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
    guestPhoneSchema.optional(),
  ),
  partySize: partyCount,
  allowDuplicate: z
    .preprocess((v) => v === true || v === 'on' || v === 'true', z.boolean())
    .default(false),
  idempotencyKey: idempotencyKeySchema,
});

export interface DoorWriteResult {
  /** True when this key was already applied: the stored result is returned, nothing new. */
  replayed: boolean;
  guest: DoorGuest;
}

type LogRow = typeof checkInLogs.$inferSelect;

/**
 * Serializes requests carrying the same idempotency key (a double tap, or a retry after a
 * timeout) and returns the earlier ledger row if the key was already used. A key reused for a
 * different guest or action is refused.
 */
async function claimKey(
  tx: DbOrTx,
  key: string,
  expect: { eventId: string; guestId?: string; action: LogRow['action'] },
): Promise<LogRow | null> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
  const [prior] = await tx.select().from(checkInLogs).where(eq(checkInLogs.idempotencyKey, key));
  if (!prior) return null;
  if (
    prior.eventId !== expect.eventId ||
    prior.action !== expect.action ||
    (expect.guestId && prior.guestId !== expect.guestId)
  ) {
    throw new DomainError('idempotency_conflict');
  }
  return prior;
}

async function lockDoorGuest(tx: DbOrTx, eventId: string, guestId: string) {
  const [g] = await tx
    .select()
    .from(guests)
    .where(and(eq(guests.eventId, eventId), eq(guests.id, guestId), isNull(guests.anonymizedAt)))
    .for('update');
  if (!g) throw new DomainError('not_found');
  const [rsvp] = await tx.select().from(rsvps).where(eq(rsvps.guestId, guestId));
  if (!rsvp) throw new DomainError('not_found');
  const [att] = await tx
    .select({ n: attendance.checkedInCount })
    .from(attendance)
    .where(eq(attendance.guestId, guestId));
  return { guest: g, rsvp, checkedIn: att?.n ?? 0 };
}

function requireLive(event: EventRow) {
  if (event.disabledAt || event.status !== 'live') {
    throw new DomainError('checkin_not_open', undefined, { status: event.status });
  }
}

/**
 * Admits `count` people of a guest's party. Follows the approved sequence: share-lock the event,
 * lock the guest, replay a seen key, check every guard, append the ledger row (the database
 * applies it to attendance and re-checks the party size), record activity, commit.
 */
export async function checkIn(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
  input: unknown,
): Promise<DoorWriteResult> {
  const data = parseInput(checkInSchema, input);
  if (data.method === 'qr' && !data.passId) throw new DomainError('validation_failed');
  return ctx.db.transaction(async (tx) => {
    const now = ctx.now();
    const access = await requireDoorAccess(tx, caller, eventId, 'scan', { forShare: true, now });
    const { guest, rsvp, checkedIn } = await lockDoorGuest(tx, eventId, data.guestId);
    const prior = await claimKey(tx, data.idempotencyKey, {
      eventId,
      guestId: guest.id,
      action: 'check_in',
    });
    if (prior)
      return { replayed: true, guest: await buildDoorGuest(tx, access, guest.id, null, now) };

    requireLive(access.event);
    if (guest.status !== 'active') throw new DomainError('guest_not_active');
    if (rsvp.status === 'pending') throw new DomainError('not_confirmed');
    if (rsvp.status === 'declined') throw new DomainError('rsvp_declined');
    if (data.method === 'qr') {
      const passId = await activePassId(tx, guest.id);
      if (passId !== data.passId) throw new DomainError('pass_revoked');
    }
    const expected = 1 + rsvp.companionCount;
    const remaining = expected - checkedIn;
    if (remaining <= 0) {
      throw new DomainError('party_complete', undefined, { expected, checkedIn });
    }
    if (data.count > remaining) {
      throw new DomainError('count_over_remaining', undefined, { remaining });
    }
    await tx.insert(checkInLogs).values({
      eventId,
      guestId: guest.id,
      action: 'check_in',
      method: data.method,
      countDelta: data.count,
      resultingCount: checkedIn + data.count,
      passId: data.method === 'qr' ? data.passId! : null,
      actorMembershipId: access.member.id,
      staffSessionId: access.staffSessionId,
      idempotencyKey: data.idempotencyKey,
      createdAt: now,
    });
    await recordActivities(tx, [
      {
        type: 'attendance.checked_in',
        actor: access.actor,
        eventId,
        workspaceId: access.event.workspaceId,
        guestId: guest.id,
        data: { count: data.count, resulting: checkedIn + data.count, method: data.method },
      },
    ]);
    return { replayed: false, guest: await buildDoorGuest(tx, access, guest.id, null, now) };
  });
}

/**
 * Corrects a guest's count up or down, always with a reason, as a new ledger row. Owner and
 * supervisors while live; the owner within the reopen window after completion. Never below 0 or
 * above the expected party.
 */
export async function correctAttendance(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
  input: unknown,
): Promise<DoorWriteResult> {
  const data = parseInput(correctionSchema, input);
  return ctx.db.transaction(async (tx) => {
    const now = ctx.now();
    const access = await requireDoorAccess(tx, caller, eventId, 'correct', { forShare: true, now });
    const { guest, rsvp, checkedIn } = await lockDoorGuest(tx, eventId, data.guestId);
    const prior = await claimKey(tx, data.idempotencyKey, {
      eventId,
      guestId: guest.id,
      action: 'correction',
    });
    if (prior)
      return { replayed: true, guest: await buildDoorGuest(tx, access, guest.id, null, now) };

    if (!correctionOpen(access.event, access.member, now)) {
      throw new DomainError('checkin_not_open', undefined, { status: access.event.status });
    }
    const expected =
      guest.status === 'active' && rsvp.status === 'confirmed' ? 1 + rsvp.companionCount : 0;
    const resulting = checkedIn + data.delta;
    if (resulting < 0 || (data.delta > 0 && resulting > expected)) {
      throw new DomainError('correction_out_of_range', undefined, { checkedIn, expected });
    }
    await tx.insert(checkInLogs).values({
      eventId,
      guestId: guest.id,
      action: 'correction',
      method: 'dashboard',
      countDelta: data.delta,
      resultingCount: resulting,
      reason: data.reason,
      actorMembershipId: access.member.id,
      staffSessionId: access.staffSessionId,
      idempotencyKey: data.idempotencyKey,
      createdAt: now,
    });
    // The reason stays in the ledger; activity records only that one was given.
    await recordActivities(tx, [
      {
        type: 'attendance.corrected',
        actor: access.actor,
        eventId,
        workspaceId: access.event.workspaceId,
        guestId: guest.id,
        data: { delta: data.delta, resulting },
      },
    ]);
    return { replayed: false, guest: await buildDoorGuest(tx, access, guest.id, null, now) };
  });
}

/**
 * A supervisor (or the owner) confirms an unanswered guest at the door, within their allowance.
 * Only pending → confirmed; a guest who already confirmed is left as is (the same pass), and a
 * declined answer is the owner's to change.
 */
export async function confirmAtDoor(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
  guestId: string,
  companions: number,
): Promise<DoorWriteResult> {
  const n = parseInput(
    z.object({ companions: z.coerce.number().int().min(0).max(MAX_COMPANIONS) }),
    { companions },
  ).companions;
  return ctx.db.transaction(async (tx) => {
    const now = ctx.now();
    const access = await requireDoorAccess(tx, caller, eventId, 'confirm_rsvp', {
      forShare: true,
      now,
    });
    requireLive(access.event);
    const { guest, rsvp } = await lockDoorGuest(tx, eventId, guestId);
    if (guest.status !== 'active') throw new DomainError('guest_not_active');
    if (rsvp.status === 'confirmed') {
      return { replayed: true, guest: await buildDoorGuest(tx, access, guest.id, null, now) };
    }
    if (rsvp.status === 'declined') throw new DomainError('rsvp_declined');
    await applyRsvp(
      tx,
      { event: access.event, guest, rsvp },
      { status: 'confirmed', companions: n },
      access.actor,
      now,
      ctx.encryptionKey,
    );
    return { replayed: false, guest: await buildDoorGuest(tx, access, guest.id, null, now) };
  });
}

/** A guest with the walk-in's phone number, as the door may see them (phone masked). */
export interface DoorDuplicate {
  guestId: string;
  name: string;
  group: string | null;
  maskedPhone: string | null;
  guestStatus: 'active' | 'cancelled';
}

export type WalkInResult =
  ({ status: 'admitted' } & DoorWriteResult) | { status: 'duplicate'; duplicates: DoorDuplicate[] };

function toDoorDuplicate(d: DuplicateGuest): DoorDuplicate {
  return {
    guestId: d.id,
    name: d.fullName,
    group: d.groupName,
    maskedPhone: maskPhone(d.phoneE164),
    guestStatus: d.status,
  };
}

/**
 * Registers someone who arrived without an invitation and admits their party in one step. A
 * walk-in is an ordinary guest (source `walk_in`, phone optional) with a confirmed answer, so
 * reports and the guest list treat them like everyone else and can show them separately.
 */
export async function registerWalkIn(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
  input: unknown,
): Promise<WalkInResult> {
  const data = parseInput(walkInSchema, input);
  return ctx.db.transaction(async (tx) => {
    const now = ctx.now();
    const access = await requireDoorAccess(tx, caller, eventId, 'walk_in', { forShare: true, now });
    const prior = await claimKey(tx, data.idempotencyKey, { eventId, action: 'walk_in' });
    if (prior) {
      return {
        status: 'admitted',
        replayed: true,
        guest: await buildDoorGuest(tx, access, prior.guestId, null, now),
      };
    }
    requireLive(access.event);
    if (data.phone && !data.allowDuplicate) {
      const duplicates = await findDuplicates(tx, eventId, data.phone.e164);
      if (duplicates.length) {
        return { status: 'duplicate', duplicates: duplicates.map(toDoorDuplicate) };
      }
    }
    const guestId = newId();
    const companions = data.partySize - 1;
    await tx.insert(guests).values({
      id: guestId,
      eventId,
      groupId: null,
      fullName: data.fullName,
      nameSearch: searchForm(data.fullName),
      phoneOriginal: data.phone?.original ?? null,
      phoneE164: data.phone?.e164 ?? null,
      allowedCompanions: companions,
      source: 'walk_in',
      createdByMembershipId: access.member.id,
      createdAt: now,
      updatedAt: now,
    });
    const scope = { actor: access.actor, workspaceId: access.event.workspaceId, now };
    const entries: ActivityInput[] = [
      {
        type: 'guest.created',
        actor: access.actor,
        eventId,
        workspaceId: access.event.workspaceId,
        guestId,
        data: { source: 'walk_in' },
      },
      ...(await createGuestLifecycle(tx, [{ id: guestId, eventId }], {
        ...scope,
        key: ctx.encryptionKey,
      })),
    ];
    await recordActivities(tx, entries);
    const { guest, rsvp } = await lockDoorGuest(tx, eventId, guestId);
    await applyRsvp(
      tx,
      { event: access.event, guest, rsvp },
      { status: 'confirmed', companions },
      access.actor,
      now,
      ctx.encryptionKey,
    );
    await tx.insert(checkInLogs).values({
      eventId,
      guestId,
      action: 'walk_in',
      method: 'walk_in',
      countDelta: data.partySize,
      resultingCount: data.partySize,
      actorMembershipId: access.member.id,
      staffSessionId: access.staffSessionId,
      idempotencyKey: data.idempotencyKey,
      createdAt: now,
    });
    await recordActivities(tx, [
      {
        type: 'attendance.walk_in',
        actor: access.actor,
        eventId,
        workspaceId: access.event.workspaceId,
        guestId,
        data: { count: data.partySize },
      },
    ]);
    return {
      status: 'admitted',
      replayed: false,
      guest: await buildDoorGuest(tx, access, guestId, null, now),
    };
  });
}
