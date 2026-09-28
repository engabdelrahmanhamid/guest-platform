import 'server-only';
import { getEventView, isDomainError } from '@gp/core';
import { notFound } from 'next/navigation';
import { getCoreContext } from './server';
import { requirePrincipal } from './session';

/** Loads the event for the signed-in user, or renders 404 when they have no access to it. */
export async function loadEventView(eventId: string) {
  const principal = await requirePrincipal();
  try {
    return { principal, view: await getEventView(getCoreContext(), principal.user.id, eventId) };
  } catch (err) {
    if (isDomainError(err, 'not_found') || isDomainError(err, 'forbidden')) notFound();
    throw err;
  }
}
