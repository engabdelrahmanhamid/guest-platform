'use server';

import {
  guardPublicRequest,
  isDomainError,
  isPublicToken,
  noteUnknownToken,
  respondToInvitation,
} from '@gp/core';
import { notFound, redirect } from 'next/navigation';
import { publicClient } from '@/lib/public';
import { getCoreContext, getLogger } from '@/lib/server';

/**
 * The guest's answer. Works without JavaScript: the form posts, and the page reloads showing the
 * saved answer (or why it wasn't saved) at the answer section.
 */
export async function respondAction(token: string, formData: FormData) {
  if (!isPublicToken(token)) notFound();
  const ctx = getCoreContext();
  const client = await publicClient();
  let target: string;
  try {
    await guardPublicRequest(ctx.db, 'rsvp', client, token, ctx.now());
    const { rsvp } = await respondToInvitation(ctx, token, {
      status: formData.get('status'),
      companions: formData.get('companions') ?? undefined,
    });
    target = rsvp.status === 'confirmed' ? `?saved=confirmed#rsvp` : `?saved=declined#rsvp`;
  } catch (err) {
    if (isDomainError(err, 'not_found')) {
      await noteUnknownToken(ctx.db, client, ctx.now());
      notFound();
    }
    if (isDomainError(err)) {
      target = `?e=${err.code}#rsvp`;
    } else {
      getLogger().error({ err }, 'guest answer failed');
      target = `?e=generic#rsvp`;
    }
  }
  redirect(`/i/${token}${target}`);
}
