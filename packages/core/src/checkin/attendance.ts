import {
  attendance,
  checkInLogs,
  eventMemberships,
  guests,
  rsvps,
  staffSessions,
} from '@gp/db/schema';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { requireEventAccess } from '../authorization/authorization';
import { lifecycleTimes } from '../events/lifecycle';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { attendanceStatus, type AttendanceStatus, correctionOpen } from './checkin';
import { type DoorCaller, doorCan, requireDoorAccess } from './door';

/**
 * Live totals, from the tables (the ledger's projection), with the approved definitions:
 * - expected people: active guests with a confirmed answer, 1 + companions each, excluding
 *   walk-ins, so walk-ins never inflate the invited forecast
 * - checked in: everyone inside, invited and walk-ins alike
 * - parties: invited confirmed guests by arrival (not arrived / partial / complete)
 */
export interface AttendanceTotals {
  expectedPeople: number;
  expectedParties: number;
  checkedInPeople: number;
  invitedCheckedIn: number;
  walkInPeople: number;
  walkInParties: number;
  complete: number;
  partial: number;
  notArrived: number;
  pendingGuests: number;
}

export async function attendanceTotals(db: DbOrTx, eventId: string): Promise<AttendanceTotals> {
  const [row] = await db
    .select({
      expectedPeople: sql<number>`coalesce(sum(1 + ${rsvps.companionCount}) filter (where ${guests.status} = 'active' and ${rsvps.status} = 'confirmed' and ${guests.source} <> 'walk_in'), 0)::int`,
      expectedParties: sql<number>`count(*) filter (where ${guests.status} = 'active' and ${rsvps.status} = 'confirmed' and ${guests.source} <> 'walk_in')::int`,
      checkedInPeople: sql<number>`coalesce(sum(${attendance.checkedInCount}), 0)::int`,
      invitedCheckedIn: sql<number>`coalesce(sum(${attendance.checkedInCount}) filter (where ${guests.source} <> 'walk_in'), 0)::int`,
      walkInPeople: sql<number>`coalesce(sum(${attendance.checkedInCount}) filter (where ${guests.source} = 'walk_in'), 0)::int`,
      walkInParties: sql<number>`count(*) filter (where ${guests.source} = 'walk_in' and ${attendance.checkedInCount} > 0)::int`,
      complete: sql<number>`count(*) filter (where ${guests.status} = 'active' and ${rsvps.status} = 'confirmed' and ${guests.source} <> 'walk_in' and coalesce(${attendance.checkedInCount}, 0) >= 1 + ${rsvps.companionCount})::int`,
      partial: sql<number>`count(*) filter (where ${guests.status} = 'active' and ${rsvps.status} = 'confirmed' and ${guests.source} <> 'walk_in' and coalesce(${attendance.checkedInCount}, 0) between 1 and ${rsvps.companionCount})::int`,
      notArrived: sql<number>`count(*) filter (where ${guests.status} = 'active' and ${rsvps.status} = 'confirmed' and ${guests.source} <> 'walk_in' and coalesce(${attendance.checkedInCount}, 0) = 0)::int`,
      pendingGuests: sql<number>`count(*) filter (where ${guests.status} = 'active' and ${rsvps.status} = 'pending')::int`,
    })
    .from(guests)
    .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
    .leftJoin(attendance, eq(attendance.guestId, guests.id))
    .where(and(eq(guests.eventId, eventId), isNull(guests.anonymizedAt)));
  return row!;
}

/** The totals alone, for the event overview. */
export async function attendanceSummary(
  ctx: CoreContext,
  userId: string,
  eventId: string,
): Promise<AttendanceTotals> {
  await requireEventAccess(ctx.db, userId, eventId, 'guests.view');
  return attendanceTotals(ctx.db, eventId);
}

export interface ArrivalRow {
  id: number;
  at: Date;
  guestId: string;
  guestName: string;
  action: 'check_in' | 'correction' | 'walk_in';
  method: 'qr' | 'search' | 'walk_in' | 'dashboard';
  delta: number;
  resulting: number;
  by: string;
}

async function recentArrivals(db: DbOrTx, eventId: string, limit: number): Promise<ArrivalRow[]> {
  return db
    .select({
      id: checkInLogs.id,
      at: checkInLogs.createdAt,
      guestId: checkInLogs.guestId,
      guestName: guests.fullName,
      action: checkInLogs.action,
      method: checkInLogs.method,
      delta: checkInLogs.countDelta,
      resulting: checkInLogs.resultingCount,
      by: eventMemberships.displayName,
    })
    .from(checkInLogs)
    .innerJoin(guests, eq(guests.id, checkInLogs.guestId))
    .innerJoin(eventMemberships, eq(eventMemberships.id, checkInLogs.actorMembershipId))
    .where(eq(checkInLogs.eventId, eventId))
    .orderBy(desc(checkInLogs.id))
    .limit(limit);
}

export interface LiveAttendance {
  status: string;
  checkinOpensAt: Date;
  checkinClosesAt: Date;
  totals: AttendanceTotals;
  recent: ArrivalRow[];
  byMember: { membershipId: string; name: string; role: 'owner' | 'staff'; admitted: number }[];
  /** Arrivals per 15 minutes since the first one, for the pace line. */
  pace: { at: Date; people: number }[];
}

/** The owner's live attendance page. */
export async function getLiveAttendance(
  ctx: CoreContext,
  userId: string,
  eventId: string,
): Promise<LiveAttendance> {
  const { event } = await requireEventAccess(ctx.db, userId, eventId, 'guests.view');
  const times = lifecycleTimes(event);
  const [totals, recent, byMember, pace] = await Promise.all([
    attendanceTotals(ctx.db, eventId),
    recentArrivals(ctx.db, eventId, 15),
    ctx.db
      .select({
        membershipId: eventMemberships.id,
        name: eventMemberships.displayName,
        role: eventMemberships.role,
        admitted: sql<number>`coalesce(sum(${checkInLogs.countDelta}) filter (where ${checkInLogs.countDelta} > 0), 0)::int`,
      })
      .from(checkInLogs)
      .innerJoin(eventMemberships, eq(eventMemberships.id, checkInLogs.actorMembershipId))
      .where(eq(checkInLogs.eventId, eventId))
      .groupBy(eventMemberships.id)
      .orderBy(desc(sql`4`)),
    ctx.db
      .select({
        at: sql<Date>`date_bin('15 minutes', ${checkInLogs.createdAt}, timestamptz '2000-01-01')`,
        people: sql<number>`sum(${checkInLogs.countDelta})::int`,
      })
      .from(checkInLogs)
      .where(eq(checkInLogs.eventId, eventId))
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);
  return {
    status: event.status,
    checkinOpensAt: times.checkinOpensAt,
    checkinClosesAt: times.checkinClosesAt,
    totals,
    recent,
    byMember,
    pace: pace.map((p) => ({ at: new Date(p.at), people: p.people })),
  };
}

export interface DoorOverview {
  event: {
    id: string;
    name: string;
    status: string;
    venueName: string;
    startsAt: Date;
    timezone: string;
    checkinOpensAt: Date;
  };
  member: { name: string; role: 'owner' | 'staff'; isSupervisor: boolean };
  can: { correct: boolean; walkIn: boolean; confirm: boolean; manageAccess: boolean };
  totals: { checkedInPeople: number; expectedPeople: number; walkInPeople: number };
}

/** The scanner's header: which event, who is scanning, what they may do, and the live count. */
export async function getDoorOverview(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
): Promise<DoorOverview> {
  const access = await requireDoorAccess(ctx.db, caller, eventId, 'scan', { now: ctx.now() });
  const { event, member } = access;
  const totals = await attendanceTotals(ctx.db, eventId);
  return {
    event: {
      id: event.id,
      name: event.name,
      status: event.status,
      venueName: event.venueName,
      startsAt: event.startsAt,
      timezone: event.timezone,
      checkinOpensAt: lifecycleTimes(event).checkinOpensAt,
    },
    member: { name: member.displayName, role: member.role, isSupervisor: member.isSupervisor },
    can: {
      correct: doorCan(member, 'correct'),
      walkIn: doorCan(member, 'walk_in'),
      confirm: doorCan(member, 'confirm_rsvp'),
      manageAccess: doorCan(member, 'manage_access'),
    },
    totals: {
      checkedInPeople: totals.checkedInPeople,
      expectedPeople: totals.expectedPeople,
      walkInPeople: totals.walkInPeople,
    },
  };
}

export interface GuestAttendanceView {
  checkedIn: number;
  expected: number;
  status: AttendanceStatus;
  canCorrect: boolean;
  history: {
    id: number;
    at: Date;
    action: 'check_in' | 'correction' | 'walk_in';
    method: 'qr' | 'search' | 'walk_in' | 'dashboard';
    delta: number;
    resulting: number;
    reason: string | null;
    by: string;
    device: string | null;
  }[];
}

/** The attendance section of the owner's guest drawer: the count and the full ledger. */
export async function getGuestAttendance(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
): Promise<GuestAttendanceView> {
  const access = await requireEventAccess(ctx.db, userId, eventId, 'guests.view');
  const [row] = await ctx.db
    .select({ guest: guests, rsvp: rsvps, checkedIn: attendance.checkedInCount })
    .from(guests)
    .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
    .leftJoin(attendance, eq(attendance.guestId, guests.id))
    .where(and(eq(guests.eventId, eventId), eq(guests.id, guestId), isNull(guests.anonymizedAt)));
  if (!row) throw new DomainError('not_found');
  const expected =
    row.guest.status === 'active' && row.rsvp.status === 'confirmed'
      ? 1 + row.rsvp.companionCount
      : 0;
  const checkedIn = row.checkedIn ?? 0;
  const history = await ctx.db
    .select({
      id: checkInLogs.id,
      at: checkInLogs.createdAt,
      action: checkInLogs.action,
      method: checkInLogs.method,
      delta: checkInLogs.countDelta,
      resulting: checkInLogs.resultingCount,
      reason: checkInLogs.reason,
      by: eventMemberships.displayName,
      device: staffSessions.deviceLabel,
    })
    .from(checkInLogs)
    .innerJoin(eventMemberships, eq(eventMemberships.id, checkInLogs.actorMembershipId))
    .leftJoin(staffSessions, eq(staffSessions.id, checkInLogs.staffSessionId))
    .where(eq(checkInLogs.guestId, guestId))
    .orderBy(desc(checkInLogs.id));
  const member = {
    id: access.membership.id,
    role: access.membership.role,
    isSupervisor: access.membership.isSupervisor,
    displayName: '',
  };
  return {
    checkedIn,
    expected,
    status: attendanceStatus(checkedIn, expected),
    canCorrect:
      access.membership.role === 'owner' &&
      correctionOpen(access.event, member, ctx.now()) &&
      (checkedIn > 0 || expected > 0),
    history,
  };
}
