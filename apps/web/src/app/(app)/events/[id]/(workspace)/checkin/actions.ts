'use server';

import { revokeStaffAccess, sendStaffAccess, whatsappUrl } from '@gp/core';
import { revalidatePath } from 'next/cache';
import { getTranslations } from 'next-intl/server';
import { type FormState, toFormState } from '@/lib/form';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

/**
 * Sends (or re-sends) a staff member's one-time access link. The link comes back to this page
 * once, for the owner to share by WhatsApp or copy; it is never put in a URL or stored in the
 * clear.
 */
export async function sendAccessAction(
  eventId: string,
  eventName: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const membershipId = String(data.get('membershipId') ?? '');
  let result;
  try {
    result = await sendStaffAccess(
      getCoreContext(),
      { kind: 'owner', userId: principal.user.id },
      eventId,
      membershipId,
    );
  } catch (err) {
    return toFormState(err);
  }
  const t = await getTranslations('checkin.team');
  const text = t('shareText', { name: result.staffName, event: eventName, url: result.url });
  revalidatePath(`/events/${eventId}/checkin`);
  return {
    ok: true,
    data: {
      url: result.url,
      text,
      waUrl: whatsappUrl(result.staffPhone, text) ?? '',
      name: result.staffName,
    },
  };
}

export async function revokeAccessAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    const { changed } = await revokeStaffAccess(
      getCoreContext(),
      { kind: 'owner', userId: principal.user.id },
      eventId,
      String(data.get('membershipId') ?? ''),
    );
    revalidatePath(`/events/${eventId}/checkin`);
    return { ok: true, message: changed ? 'revoked' : 'nothingToRevoke' };
  } catch (err) {
    return toFormState(err);
  }
}
