'use server';

import {
  correctAttendance,
  isDomainError,
  recordInvitationShare,
  replaceGuestPass,
  rotateInvitationLink,
  setGuestRsvp,
  type ShareMethod,
} from '@gp/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type FormState, toFormState } from '@/lib/form';
import { getCoreContext, getLogger } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

/** Invitation, answer and pass actions shared by the guest drawer and the share queue. */

function back(eventId: string, data: FormData, done: string): string {
  const raw = data.get('returnTo');
  const from =
    typeof raw === 'string' && raw.startsWith(`/events/${eventId}/`)
      ? raw
      : `/events/${eventId}/guests`;
  const url = new URL(from, 'http://x');
  url.searchParams.set('done', done);
  return `${url.pathname}${url.search}`;
}

const SHARE_METHODS: ShareMethod[] = ['whatsapp', 'copy_link', 'copy_text'];

/**
 * Called by the share buttons after the owner opened WhatsApp or copied the invitation. Records
 * "shared" (never "delivered"). Returns an error code instead of throwing so the button can say
 * what went wrong without leaving the page.
 */
export async function recordShareAction(
  eventId: string,
  guestId: string,
  method: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!SHARE_METHODS.includes(method as ShareMethod)) return { ok: false, error: 'generic' };
  const principal = await requirePrincipal();
  try {
    await recordInvitationShare(
      getCoreContext(),
      principal.user.id,
      eventId,
      guestId,
      method as ShareMethod,
    );
  } catch (err) {
    if (isDomainError(err)) return { ok: false, error: err.code };
    getLogger().error({ err }, 'recording a share failed');
    return { ok: false, error: 'generic' };
  }
  revalidatePath(`/events/${eventId}`, 'layout');
  return { ok: true };
}

export async function rotateLinkAction(
  eventId: string,
  guestId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await rotateInvitationLink(getCoreContext(), principal.user.id, eventId, guestId);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/events/${eventId}`, 'layout');
  redirect(back(eventId, data, 'link_rotated'));
}

export async function setRsvpAction(
  eventId: string,
  guestId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await setGuestRsvp(getCoreContext(), principal.user.id, eventId, guestId, {
      status: data.get('status'),
      companions: data.get('companions') ?? undefined,
    });
  } catch (err) {
    return toFormState(err, data);
  }
  revalidatePath(`/events/${eventId}`, 'layout');
  redirect(back(eventId, data, 'rsvp_saved'));
}

export async function replacePassAction(
  eventId: string,
  guestId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await replaceGuestPass(getCoreContext(), principal.user.id, eventId, guestId);
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/events/${eventId}`, 'layout');
  redirect(back(eventId, data, 'pass_replaced'));
}

/** The owner corrects a guest's attendance from the drawer: a new ledger row with a reason. */
export async function correctAttendanceAction(
  eventId: string,
  guestId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await correctAttendance(
      getCoreContext(),
      { kind: 'owner', userId: principal.user.id },
      eventId,
      {
        guestId,
        delta: String(data.get('delta') ?? '').replace(/^\+/, ''),
        reason: data.get('reason'),
        idempotencyKey: data.get('idempotencyKey'),
      },
    );
  } catch (err) {
    return toFormState(err, data);
  }
  revalidatePath(`/events/${eventId}`, 'layout');
  redirect(back(eventId, data, 'attendance_corrected'));
}
