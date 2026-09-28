'use server';

import { removeEventImage, saveInvitationDesign, uploadEventImage } from '@gp/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type FormState, formObject, toFormState } from '@/lib/form';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

const page = (eventId: string, done: string) => `/events/${eventId}/invitation?done=${done}`;

export async function saveDesignAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const f = formObject(data);
  // A custom colour, when chosen, wins over the swatches.
  const primaryColor = f.colorChoice === 'custom' ? f.customColor : f.colorChoice;
  try {
    await saveInvitationDesign(getCoreContext(), principal.user.id, eventId, {
      ...f,
      primaryColor,
    });
  } catch (err) {
    return toFormState(err, data);
  }
  revalidatePath(`/events/${eventId}`, 'layout');
  redirect(page(eventId, 'design_saved'));
}

export async function imageAction(
  eventId: string,
  kind: 'cover' | 'logo',
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const ctx = getCoreContext();
  try {
    if (data.get('op') === 'remove') {
      await removeEventImage(ctx, principal.user.id, eventId, kind);
    } else {
      const file = data.get('file');
      if (!(file instanceof File) || file.size === 0) return { error: 'file_missing' };
      await uploadEventImage(
        ctx,
        principal.user.id,
        eventId,
        kind,
        Buffer.from(await file.arrayBuffer()),
      );
    }
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/events/${eventId}`, 'layout');
  redirect(page(eventId, `${kind}_${data.get('op') === 'remove' ? 'removed' : 'saved'}`));
}
