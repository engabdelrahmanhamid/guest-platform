'use server';

import {
  guardPublicRequest,
  isDomainError,
  isStaffLinkToken,
  noteUnknownToken,
  redeemStaffLink,
} from '@gp/core';
import { notFound, redirect } from 'next/navigation';
import { deviceLabel, setStaffCookie } from '@/lib/door';
import { publicClient } from '@/lib/public';
import { getCoreContext } from '@/lib/server';

/**
 * Continue on this device: redeems the one-time link, puts the device session in an http-only
 * cookie and opens the scanner. A link already used (another tap, another device) reloads the
 * page, which then says so.
 */
export async function redeemAction(token: string) {
  if (!isStaffLinkToken(token)) notFound();
  const ctx = getCoreContext();
  const client = await publicClient();
  let eventId: string;
  try {
    await guardPublicRequest(ctx.db, 'rsvp', client, token, ctx.now());
    const session = await redeemStaffLink(ctx, token, await deviceLabel());
    await setStaffCookie(session.sessionToken);
    eventId = session.eventId;
  } catch (err) {
    if (isDomainError(err, 'staff_link_invalid')) {
      if (!err.details.state) await noteUnknownToken(ctx.db, client, ctx.now());
      redirect(`/s/${token}`);
    }
    if (isDomainError(err, 'rate_limited')) redirect(`/s/${token}`);
    throw err;
  }
  redirect(`/scan/${eventId}`);
}
