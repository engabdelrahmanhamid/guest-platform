import { eventMemberships, events, staffSessions } from '@gp/db/schema';
import { and, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import type { Actor } from '../activity/activity';
import { type EventRow, requireEventAccess } from '../authorization/authorization';
import type { DbOrTx } from '../shared/context';
import { sha256 } from '../shared/crypto';
import { DomainError } from '../shared/errors';

/**
 * Who is operating the door. Owners arrive with their normal login; staff arrive with the device
 * session their access link created. Both end up as an event membership, which every ledger and
 * activity row records.
 */
export type DoorCaller =
  { kind: 'owner'; userId: string } | { kind: 'staff'; sessionToken: string };

/**
 * What each door role may do (approved capability matrix):
 * - `scan`: look up passes and guests, check people in up to the remaining count. Everyone.
 * - `correct`, `walk_in`, `confirm_rsvp`, `manage_access`: the owner and supervisors only.
 */
export type DoorCapability = 'scan' | 'correct' | 'walk_in' | 'confirm_rsvp' | 'manage_access';

export interface DoorMember {
  id: string;
  role: 'owner' | 'staff';
  isSupervisor: boolean;
  displayName: string;
}

export interface DoorAccess {
  event: EventRow;
  member: DoorMember;
  actor: Extract<Actor, { type: 'member' }>;
  /** The staff device session, or null for the owner. */
  staffSessionId: string | null;
}

export function doorCan(member: Pick<DoorMember, 'role' | 'isSupervisor'>, cap: DoorCapability) {
  return cap === 'scan' || member.role === 'owner' || member.isSupervisor;
}

/** Staff sessions work while the event is published and not yet over. */
const STAFF_EVENT_STATUSES = ['active', 'live'] as const;
const LAST_SEEN_RESOLUTION_MS = 60_000;
/** A device stays signed in for at most this long, on the server as well as in its cookie. */
export const STAFF_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

/**
 * Resolves the caller for one event and checks `capability`. Inside a transaction, `forShare`
 * keeps the event's state (and a staff member's membership) from changing until commit, so a
 * check-in in flight either lands before the owner ends the event or removes the staff member,
 * or is refused.
 */
export async function requireDoorAccess(
  db: DbOrTx,
  caller: DoorCaller,
  eventId: string,
  capability: DoorCapability,
  opts: { forShare?: boolean; now?: Date } = {},
): Promise<DoorAccess> {
  if (caller.kind === 'owner') {
    const access = await requireEventAccess(db, caller.userId, eventId, 'checkin.operate', {
      forShare: opts.forShare,
    });
    const [m] = await db
      .select({ displayName: eventMemberships.displayName })
      .from(eventMemberships)
      .where(eq(eventMemberships.id, access.membership.id));
    const member: DoorMember = { ...access.membership, displayName: m?.displayName ?? '' };
    if (!doorCan(member, capability)) throw new DomainError('forbidden');
    return { event: access.event, member, actor: access.actor, staffSessionId: null };
  }

  const now = opts.now ?? new Date();
  const base = db
    .select({ session: staffSessions, member: eventMemberships, event: events })
    .from(staffSessions)
    .innerJoin(eventMemberships, eq(eventMemberships.id, staffSessions.membershipId))
    .innerJoin(events, eq(events.id, staffSessions.eventId))
    .where(
      and(
        eq(staffSessions.tokenHash, sha256(caller.sessionToken)),
        eq(staffSessions.eventId, eventId),
        isNull(staffSessions.endedAt),
        gt(staffSessions.createdAt, new Date(now.getTime() - STAFF_SESSION_MAX_AGE_SECONDS * 1000)),
        ne(eventMemberships.status, 'removed'),
        eq(eventMemberships.role, 'staff'),
        inArray(events.status, [...STAFF_EVENT_STATUSES]),
        isNull(events.disabledAt),
      ),
    );
  const [row] = await (opts.forShare
    ? base.for('share', { of: [events, eventMemberships] })
    : base);
  if (!row) throw new DomainError('staff_session_invalid');
  const member: DoorMember = {
    id: row.member.id,
    role: 'staff',
    isSupervisor: row.member.isSupervisor,
    displayName: row.member.displayName,
  };
  if (!doorCan(member, capability)) throw new DomainError('forbidden');
  if (now.getTime() - row.session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) {
    await db
      .update(staffSessions)
      .set({ lastSeenAt: now })
      .where(eq(staffSessions.id, row.session.id));
  }
  return {
    event: row.event,
    member,
    actor: { type: 'member', membershipId: member.id, userId: null },
    staffSessionId: row.session.id,
  };
}

/** Which event a staff device belongs to (the scanner's start page redirects there). */
export async function staffSessionEvent(db: DbOrTx, sessionToken: string): Promise<string | null> {
  const [row] = await db
    .select({ eventId: staffSessions.eventId })
    .from(staffSessions)
    .where(
      and(
        eq(staffSessions.tokenHash, sha256(sessionToken)),
        isNull(staffSessions.endedAt),
        gt(staffSessions.createdAt, new Date(Date.now() - STAFF_SESSION_MAX_AGE_SECONDS * 1000)),
      ),
    );
  return row?.eventId ?? null;
}
