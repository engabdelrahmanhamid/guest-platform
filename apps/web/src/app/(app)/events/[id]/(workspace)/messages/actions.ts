'use server';

import { DEFAULT_SHARE_TEXT, saveShareText } from '@gp/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type FormState, toFormState } from '@/lib/form';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

export async function saveShareTextAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const body = data.get('op') === 'reset' ? DEFAULT_SHARE_TEXT : data.get('body');
  try {
    await saveShareText(getCoreContext(), principal.user.id, eventId, { body });
  } catch (err) {
    return toFormState(err, data);
  }
  revalidatePath(`/events/${eventId}/messages`);
  redirect(`/events/${eventId}/messages?done=text_saved#share-text`);
}
