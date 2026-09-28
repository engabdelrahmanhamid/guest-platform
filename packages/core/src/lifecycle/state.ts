/**
 * Pure rules for what a guest's link, answer and pass mean in each event state. The guest page,
 * the owner's drawer and the services all use these, so they can't disagree.
 */
import type { EventStatus } from '../events/lifecycle';

export type RsvpStatus = 'pending' | 'confirmed' | 'declined';
export type PassStatus = 'active' | 'revoked';

interface EventState {
  status: EventStatus;
  cancelledAt: Date | null;
  disabledAt: Date | null;
}

/**
 * What the guest's link shows:
 * - `unavailable`: draft or disabled event, or a guest the owner cancelled. Nothing personal.
 * - `open`: active or live. The invitation with RSVP.
 * - `closed`: completed, or archived after completing. Read-only, the pass shows as ended.
 * - `cancelled`: cancelled, or archived after cancelling. A clear cancellation notice.
 */
export type InvitationPageState = 'unavailable' | 'open' | 'closed' | 'cancelled';

export function invitationPageState(
  event: EventState,
  guest: { status: 'active' | 'cancelled' },
): InvitationPageState {
  if (event.disabledAt || event.status === 'draft') return 'unavailable';
  if (event.cancelledAt || event.status === 'cancelled') return 'cancelled';
  if (guest.status !== 'active') return 'unavailable';
  if (event.status === 'active' || event.status === 'live') return 'open';
  return 'closed';
}

/** Whether answers may change. In phase 4 a guest's own changes also stop once anyone checks in. */
export function rsvpOpen(event: EventState): boolean {
  return !event.disabledAt && (event.status === 'active' || event.status === 'live');
}

/** Whether invitations can be handed out (shared, copied, exported). */
export function sharingOpen(event: EventState): boolean {
  return rsvpOpen(event);
}

/**
 * How a pass reads today. Stored states are only active/revoked; everything else is derived:
 * a pass is usable only while it is active, the guest is active, the answer is confirmed and the
 * event permits entry.
 */
export type PassDisplay = 'valid' | 'revoked' | 'cancelled' | 'ended' | 'unavailable';

export function passDisplay(
  pass: { status: PassStatus },
  guest: { status: 'active' | 'cancelled' },
  rsvp: { status: RsvpStatus },
  event: EventState,
): PassDisplay {
  if (pass.status === 'revoked') return 'revoked';
  if (event.cancelledAt || event.status === 'cancelled') return 'cancelled';
  if (event.status === 'completed' || event.status === 'archived') return 'ended';
  if (event.disabledAt || event.status === 'draft') return 'unavailable';
  if (guest.status !== 'active' || rsvp.status !== 'confirmed') return 'unavailable';
  return 'valid';
}

/** People expected for one guest: the guest plus confirmed companions, or none. */
export function expectedPartySize(
  guest: { status: 'active' | 'cancelled' },
  rsvp: { status: RsvpStatus; companionCount: number },
): number {
  return guest.status === 'active' && rsvp.status === 'confirmed' ? 1 + rsvp.companionCount : 0;
}

/** The QR content: a version prefix and the opaque pass token. No URL, name or id. */
export function qrPayload(passToken: string): string {
  return `GP1.${passToken}`;
}
