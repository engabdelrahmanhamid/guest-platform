import {
  checkInLogs,
  eventMemberships,
  events,
  staffAccessLinks,
  staffSessions,
} from '@gp/db/schema';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { recordActivity } from '../activity/activity';
import { requireEventAccess } from '../authorization/authorization';
import type { CoreContext, DbOrTx } from '../shared/context';
import { randomToken, sha256 } from '../shared/crypto';
import { DomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import { type DoorCaller, requireDoorAccess } from './door';

/**
 * Passwordless staff access (approved design): the owner or a supervisor sends a staff member a
 * one-time link; opening it only shows who it is for, and tapping Continue on a device redeems
 * it and signs that device in. Links and sessions are stored as SHA-256 hashes only.
 */
const LINK_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isStaffLinkToken(value: unknown): value is string {
  return typeof value === 'string' && LINK_TOKEN_PATTERN.test(value);
}

export function staffLinkUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/s/${token}`;
}

/** Events whose door can be operated by staff: published and not over. */
function doorOpenForStaff(event: { status: string; disabledAt: Date | null }) {
  return !event.disabledAt && (event.status === 'active' || event.status === 'live');
}

async function lockStaffMember(tx: DbOrTx, eventId: string, membershipId: string) {
  const [m] = await tx
    .select()
    .from(eventMemberships)
    .where(and(eq(eventMemberships.id, membershipId), eq(eventMemberships.eventId, eventId)))
    .for('update');
  if (!m) throw new DomainError('not_found');
  if (m.role !== 'staff') throw new DomainError('membership_not_staff');
  if (m.status === 'removed') throw new DomainError('membership_removed');
  return m;
}

/**
 * Closes a staff member's open link and signs out their devices. Used by resend, revoke and
 * removal, in the caller's transaction.
 */
export async function closeStaffAccess(
  tx: DbOrTx,
  membershipId: string,
  reason: 'revoked' | 'resent' | 'member_removed',
  endedBy: string,
  now: Date,
): Promise<{ links: number; sessions: number }> {
  const links = await tx
    .update(staffAccessLinks)
    .set({ revokedAt: now })
    .where(
      and(
        eq(staffAccessLinks.membershipId, membershipId),
        isNull(staffAccessLinks.redeemedAt),
        isNull(staffAccessLinks.revokedAt),
      ),
    )
    .returning({ id: staffAccessLinks.id });
  const sessions = await tx
    .update(staffSessions)
    .set({ endedAt: now, endReason: reason, endedByMembershipId: endedBy })
    .where(and(eq(staffSessions.membershipId, membershipId), isNull(staffSessions.endedAt)))
    .returning({ id: staffSessions.id });
  return { links: links.length, sessions: sessions.length };
}

/**
 * A supervisor manages plain staff only. A link is handed to whoever asks, so letting a
 * supervisor issue one for themselves or another supervisor would let them act as that person
 * (check-ins are attributed to the link's owner). Only the owner manages supervisors.
 */
function requireMayManage(
  access: { member: { id: string; role: string } },
  staff: { id: string; isSupervisor: boolean },
) {
  if (access.member.role === 'owner') return;
  if (staff.id === access.member.id || staff.isSupervisor) throw new DomainError('forbidden');
}

/**
 * Issues a new access link for a staff member (first send, or resend to switch devices). Any
 * open link stops working and signed-in devices are signed out, in the same transaction. The
 * raw token is returned once, for the owner to share; only its hash is stored.
 */
export async function sendStaffAccess(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
  membershipId: string,
): Promise<{ url: string; staffName: string; staffPhone: string | null; resent: boolean }> {
  return ctx.db.transaction(async (tx) => {
    const access = await requireDoorAccess(tx, caller, eventId, 'manage_access', {
      forShare: true,
      now: ctx.now(),
    });
    if (!doorOpenForStaff(access.event)) {
      throw new DomainError(
        access.event.status === 'draft' ? 'event_not_published' : 'event_not_editable',
        undefined,
        { status: access.event.status },
      );
    }
    const staff = await lockStaffMember(tx, eventId, membershipId);
    requireMayManage(access, staff);
    const now = ctx.now();
    const closed = await closeStaffAccess(tx, staff.id, 'resent', access.member.id, now);
    const token = randomToken(16);
    await tx.insert(staffAccessLinks).values({
      id: newId(),
      eventId,
      membershipId: staff.id,
      tokenHash: sha256(token),
      createdByMembershipId: access.member.id,
      createdAt: now,
    });
    const [earlier] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(staffAccessLinks)
      .where(eq(staffAccessLinks.membershipId, staff.id));
    const resent = (earlier?.n ?? 1) > 1;
    await recordActivity(tx, {
      type: 'staff.access_sent',
      actor: access.actor,
      eventId,
      workspaceId: access.event.workspaceId,
      data: { membershipId: staff.id, resent, signedOut: closed.sessions },
    });
    return {
      url: staffLinkUrl(ctx.appBaseUrl, token),
      staffName: staff.displayName,
      staffPhone: staff.phoneE164,
      resent,
    };
  });
}

/** Closes a staff member's access now: the open link stops working and devices sign out. */
export async function revokeStaffAccess(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
  membershipId: string,
): Promise<{ changed: boolean }> {
  return ctx.db.transaction(async (tx) => {
    const access = await requireDoorAccess(tx, caller, eventId, 'manage_access', {
      forShare: true,
      now: ctx.now(),
    });
    const staff = await lockStaffMember(tx, eventId, membershipId);
    requireMayManage(access, staff);
    const closed = await closeStaffAccess(tx, staff.id, 'revoked', access.member.id, ctx.now());
    const changed = closed.links + closed.sessions > 0;
    if (changed) {
      await recordActivity(tx, {
        type: 'staff.access_revoked',
        actor: access.actor,
        eventId,
        workspaceId: access.event.workspaceId,
        data: { membershipId: staff.id, links: closed.links, sessions: closed.sessions },
      });
    }
    return { changed };
  });
}

export type StaffLinkState = 'ready' | 'used' | 'closed' | 'unavailable';

export interface StaffLinkView {
  state: StaffLinkState;
  /** Shown only while the link can still be used, so a stranger learns nothing from an old one. */
  eventName: string | null;
  staffName: string | null;
  isSupervisor: boolean;
}

async function findLink(db: DbOrTx, token: string) {
  const [row] = await db
    .select({ link: staffAccessLinks, member: eventMemberships, event: events })
    .from(staffAccessLinks)
    .innerJoin(eventMemberships, eq(eventMemberships.id, staffAccessLinks.membershipId))
    .innerJoin(events, eq(events.id, staffAccessLinks.eventId))
    .where(eq(staffAccessLinks.tokenHash, sha256(token)));
  return row ?? null;
}

function linkState(row: NonNullable<Awaited<ReturnType<typeof findLink>>>): StaffLinkState {
  if (row.link.redeemedAt) return 'used';
  if (row.link.revokedAt || row.member.status === 'removed') return 'closed';
  if (!doorOpenForStaff(row.event)) return 'unavailable';
  return 'ready';
}

/**
 * What the link's confirmation page shows. Reading never redeems: link previews (WhatsApp
 * fetches every link) can't use it up. Returns null for a token that never existed.
 */
export async function getStaffLink(ctx: CoreContext, token: string): Promise<StaffLinkView | null> {
  if (!isStaffLinkToken(token)) return null;
  const row = await findLink(ctx.db, token);
  if (!row) return null;
  const state = linkState(row);
  return {
    state,
    eventName: state === 'ready' ? row.event.name : null,
    staffName: state === 'ready' ? row.member.displayName : null,
    isSupervisor: state === 'ready' && row.member.isSupervisor,
  };
}

/**
 * Redeems a link on the device that tapped Continue: marks it used, creates the device session
 * and returns its secret (the web layer puts it in an http-only cookie). Two taps race on the
 * link's row lock; the second sees it used.
 */
export async function redeemStaffLink(
  ctx: CoreContext,
  token: string,
  deviceLabel: string | null,
): Promise<{ sessionToken: string; eventId: string }> {
  if (!isStaffLinkToken(token)) throw new DomainError('staff_link_invalid');
  return ctx.db.transaction(async (tx) => {
    const [link] = await tx
      .select()
      .from(staffAccessLinks)
      .where(eq(staffAccessLinks.tokenHash, sha256(token)))
      .for('update');
    if (!link) throw new DomainError('staff_link_invalid');
    const row = await findLink(tx, token);
    const state = row ? linkState(row) : 'closed';
    if (state !== 'ready' || !row) {
      throw new DomainError('staff_link_invalid', undefined, { state });
    }
    const now = ctx.now();
    await tx
      .update(staffAccessLinks)
      .set({ redeemedAt: now })
      .where(eq(staffAccessLinks.id, link.id));
    const sessionToken = randomToken(32);
    const sessionId = newId();
    await tx.insert(staffSessions).values({
      id: sessionId,
      eventId: link.eventId,
      membershipId: link.membershipId,
      linkId: link.id,
      tokenHash: sha256(sessionToken),
      deviceLabel: deviceLabel ? deviceLabel.slice(0, 80) : null,
      createdAt: now,
      lastSeenAt: now,
    });
    if (row.member.status === 'invited') {
      await tx
        .update(eventMemberships)
        .set({ status: 'active', updatedAt: now })
        .where(eq(eventMemberships.id, link.membershipId));
    }
    await recordActivity(tx, {
      type: 'staff.device_joined',
      actor: { type: 'member', membershipId: link.membershipId, userId: null },
      eventId: link.eventId,
      workspaceId: row.event.workspaceId,
      data: { membershipId: link.membershipId, sessionId, device: deviceLabel },
    });
    return { sessionToken, eventId: link.eventId };
  });
}

/** Signs this staff device out. Unknown or already-ended sessions are a no-op. */
export async function signOutStaff(ctx: CoreContext, sessionToken: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const [s] = await tx
      .update(staffSessions)
      .set({ endedAt: ctx.now(), endReason: 'signed_out' })
      .where(and(eq(staffSessions.tokenHash, sha256(sessionToken)), isNull(staffSessions.endedAt)))
      .returning();
    if (!s) return;
    await recordActivity(tx, {
      type: 'staff.signed_out',
      actor: { type: 'member', membershipId: s.membershipId, userId: null },
      eventId: s.eventId,
      data: { membershipId: s.membershipId, sessionId: s.id },
    });
  });
}

export interface TeamMemberAccess {
  membershipId: string;
  displayName: string;
  phoneE164: string | null;
  isSupervisor: boolean;
  status: 'invited' | 'active' | 'removed';
  /** A link was sent and not used yet. */
  linkPendingSince: Date | null;
  devices: { id: string; label: string | null; since: Date; lastSeenAt: Date }[];
  admitted: number;
}

/** The door team with each member's access state, for the owner's check-in page. */
export async function listTeamAccess(
  ctx: CoreContext,
  userId: string,
  eventId: string,
): Promise<TeamMemberAccess[]> {
  await requireEventAccess(ctx.db, userId, eventId, 'members.view');
  const members = await ctx.db
    .select()
    .from(eventMemberships)
    .where(
      and(
        eq(eventMemberships.eventId, eventId),
        eq(eventMemberships.role, 'staff'),
        sql`${eventMemberships.status} <> 'removed'`,
      ),
    )
    .orderBy(asc(eventMemberships.createdAt));
  if (!members.length) return [];
  const ids = members.map((m) => m.id);
  const [links, sessions, admitted] = await Promise.all([
    ctx.db
      .select({
        membershipId: staffAccessLinks.membershipId,
        createdAt: staffAccessLinks.createdAt,
      })
      .from(staffAccessLinks)
      .where(
        and(
          inArray(staffAccessLinks.membershipId, ids),
          isNull(staffAccessLinks.redeemedAt),
          isNull(staffAccessLinks.revokedAt),
        ),
      ),
    ctx.db
      .select()
      .from(staffSessions)
      .where(and(inArray(staffSessions.membershipId, ids), isNull(staffSessions.endedAt)))
      .orderBy(desc(staffSessions.lastSeenAt)),
    ctx.db
      .select({
        membershipId: checkInLogs.actorMembershipId,
        n: sql<number>`coalesce(sum(${checkInLogs.countDelta}) filter (where ${checkInLogs.countDelta} > 0), 0)::int`,
      })
      .from(checkInLogs)
      .where(and(eq(checkInLogs.eventId, eventId), inArray(checkInLogs.actorMembershipId, ids)))
      .groupBy(checkInLogs.actorMembershipId),
  ]);
  return members.map((m) => ({
    membershipId: m.id,
    displayName: m.displayName,
    phoneE164: m.phoneE164,
    isSupervisor: m.isSupervisor,
    status: m.status,
    linkPendingSince: links.find((l) => l.membershipId === m.id)?.createdAt ?? null,
    devices: sessions
      .filter((s) => s.membershipId === m.id)
      .map((s) => ({
        id: s.id,
        label: s.deviceLabel,
        since: s.createdAt,
        lastSeenAt: s.lastSeenAt,
      })),
    admitted: admitted.find((a) => a.membershipId === m.id)?.n ?? 0,
  }));
}

export interface DoorTeamMember {
  membershipId: string;
  displayName: string;
  isSupervisor: boolean;
  /** Signed-in devices. */
  devices: number;
  linkPending: boolean;
  /** This is the caller's own membership. */
  self: boolean;
}

/**
 * The door team as a supervisor sees it on the scanner: names and access state only (no
 * phones), so they can resend or stop a colleague's access during the event.
 */
export async function listDoorTeam(
  ctx: CoreContext,
  caller: DoorCaller,
  eventId: string,
): Promise<DoorTeamMember[]> {
  const access = await requireDoorAccess(ctx.db, caller, eventId, 'manage_access', {
    now: ctx.now(),
  });
  const members = await ctx.db
    .select({
      id: eventMemberships.id,
      displayName: eventMemberships.displayName,
      isSupervisor: eventMemberships.isSupervisor,
    })
    .from(eventMemberships)
    .where(
      and(
        eq(eventMemberships.eventId, eventId),
        eq(eventMemberships.role, 'staff'),
        sql`${eventMemberships.status} <> 'removed'`,
      ),
    )
    .orderBy(asc(eventMemberships.createdAt));
  const [sessions, links] = await Promise.all([
    ctx.db
      .select({ membershipId: staffSessions.membershipId, n: sql<number>`count(*)::int` })
      .from(staffSessions)
      .where(and(eq(staffSessions.eventId, eventId), isNull(staffSessions.endedAt)))
      .groupBy(staffSessions.membershipId),
    ctx.db
      .select({ membershipId: staffAccessLinks.membershipId })
      .from(staffAccessLinks)
      .where(
        and(
          eq(staffAccessLinks.eventId, eventId),
          isNull(staffAccessLinks.redeemedAt),
          isNull(staffAccessLinks.revokedAt),
        ),
      ),
  ]);
  return members.map((m) => ({
    membershipId: m.id,
    displayName: m.displayName,
    isSupervisor: m.isSupervisor,
    devices: sessions.find((x) => x.membershipId === m.id)?.n ?? 0,
    linkPending: links.some((l) => l.membershipId === m.id),
    self: m.id === access.member.id,
  }));
}
