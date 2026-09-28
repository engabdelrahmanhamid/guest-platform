import { eventMemberships, events, guests, invitations, rsvps } from '@gp/db/schema';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { requireEventAccess } from '../authorization/authorization';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { invitationUrl } from './invitations';
import { passHistory } from './passes';
import { passDisplay, type PassDisplay, rsvpOpen, sharingOpen } from './state';

export interface RsvpSummary {
  /** Active guests: everyone who is invited. */
  invited: number;
  shared: number;
  opened: number;
  responded: number;
  confirmed: number;
  declined: number;
  pending: number;
  /** Active guests who confirmed, each counted with their confirmed companions. */
  expectedAttendance: number;
}

/**
 * Live RSVP figures for the overview and the guests page. Cancelled guests count nowhere.
 * Expected attendance never looks at passes. Final, frozen figures are a reports-phase concern.
 */
export async function rsvpSummaryFor(db: DbOrTx, eventId: string): Promise<RsvpSummary> {
  const [row] = await db
    .select({
      invited: sql<number>`count(*)`.mapWith(Number),
      shared: sql<number>`count(*) FILTER (WHERE ${invitations.shareCount} > 0)`.mapWith(Number),
      opened: sql<number>`count(*) FILTER (WHERE ${invitations.openedAt} IS NOT NULL)`.mapWith(
        Number,
      ),
      confirmed: sql<number>`count(*) FILTER (WHERE ${rsvps.status} = 'confirmed')`.mapWith(Number),
      declined: sql<number>`count(*) FILTER (WHERE ${rsvps.status} = 'declined')`.mapWith(Number),
      pending: sql<number>`count(*) FILTER (WHERE ${rsvps.status} = 'pending')`.mapWith(Number),
      expectedAttendance:
        sql<number>`coalesce(sum(1 + ${rsvps.companionCount}) FILTER (WHERE ${rsvps.status} = 'confirmed'), 0)`.mapWith(
          Number,
        ),
    })
    .from(guests)
    .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
    .innerJoin(invitations, eq(invitations.guestId, guests.id))
    .where(
      and(eq(guests.eventId, eventId), eq(guests.status, 'active'), isNull(guests.anonymizedAt)),
    );
  const r = row ?? {
    invited: 0,
    shared: 0,
    opened: 0,
    confirmed: 0,
    declined: 0,
    pending: 0,
    expectedAttendance: 0,
  };
  return { ...r, responded: r.confirmed + r.declined };
}

export async function rsvpSummary(ctx: CoreContext, userId: string, eventId: string) {
  await requireEventAccess(ctx.db, userId, eventId, 'guests.view');
  return rsvpSummaryFor(ctx.db, eventId);
}

export interface GuestLifecycleView {
  invitation: {
    link: string;
    deliveryStatus: string;
    shareCount: number;
    firstSharedAt: Date | null;
    lastSharedAt: Date | null;
    openedAt: Date | null;
    lastOpenedAt: Date | null;
    openCount: number;
    tokenRotatedAt: Date | null;
  };
  rsvp: {
    status: 'pending' | 'confirmed' | 'declined';
    companionCount: number;
    partySize: number;
    respondedAt: Date | null;
    by: 'guest' | 'member' | null;
    byName: string | null;
  };
  pass: {
    /** The active pass, or the latest one if none is active. */
    current: {
      token: string;
      issuedAt: Date;
      revokedAt: Date | null;
      revokeReason: string | null;
      display: PassDisplay;
    } | null;
    issuedCount: number;
  };
  canChangeRsvp: boolean;
  canShare: boolean;
}

/** The invitation, answer and pass sections of the guest drawer. */
export async function getGuestLifecycle(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
): Promise<GuestLifecycleView> {
  const { event } = await requireEventAccess(ctx.db, userId, eventId, 'guests.view');
  const [row] = await ctx.db
    .select({ guest: guests, inv: invitations, rsvp: rsvps, byName: eventMemberships.displayName })
    .from(guests)
    .innerJoin(invitations, eq(invitations.guestId, guests.id))
    .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
    .leftJoin(eventMemberships, eq(eventMemberships.id, rsvps.lastActorMembershipId))
    .where(and(eq(guests.eventId, eventId), eq(guests.id, guestId), isNull(guests.anonymizedAt)));
  if (!row) throw new DomainError('not_found');
  const { guest, inv, rsvp } = row;
  const passes = await passHistory(ctx.db, guestId);
  const current = passes.find((p) => p.status === 'active') ?? passes[0] ?? null;
  return {
    invitation: {
      link: invitationUrl(ctx.appBaseUrl, inv.token),
      deliveryStatus: inv.deliveryStatus,
      shareCount: inv.shareCount,
      firstSharedAt: inv.firstSharedAt,
      lastSharedAt: inv.lastSharedAt,
      openedAt: inv.openedAt,
      lastOpenedAt: inv.lastOpenedAt,
      openCount: inv.openCount,
      tokenRotatedAt: inv.tokenRotatedAt,
    },
    rsvp: {
      status: rsvp.status,
      companionCount: rsvp.companionCount,
      partySize: rsvp.status === 'confirmed' ? 1 + rsvp.companionCount : 0,
      respondedAt: rsvp.respondedAt,
      by:
        rsvp.lastActorType === 'guest' || rsvp.lastActorType === 'member'
          ? rsvp.lastActorType
          : null,
      byName: row.byName,
    },
    pass: {
      current: current
        ? {
            token: current.token,
            issuedAt: current.issuedAt,
            revokedAt: current.revokedAt,
            revokeReason: current.revokeReason,
            display: passDisplay(current, guest, rsvp, event),
          }
        : null,
      issuedCount: passes.length,
    },
    canChangeRsvp: rsvpOpen(event) && guest.status === 'active',
    canShare: sharingOpen(event) && guest.status === 'active',
  };
}

/** Whether an event has anything guest-facing yet (for the overview's readiness list). */
export function invitationLive(
  event: Pick<typeof events.$inferSelect, 'status' | 'disabledAt' | 'cancelledAt'>,
) {
  return sharingOpen(event);
}
