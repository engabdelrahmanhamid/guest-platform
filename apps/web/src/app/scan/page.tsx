import { staffSessionEvent } from '@gp/core';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignedOut } from '@/components/door/signed-out';
import { getStaffToken } from '@/lib/door';
import { getCoreContext } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: { absolute: 'الاستقبال' } };

/** The scanner's home: a signed-in staff device goes straight to its event's door. */
export default async function ScanHome() {
  const token = await getStaffToken();
  const eventId = token ? await staffSessionEvent(getCoreContext().db, token) : null;
  if (eventId) redirect(`/scan/${eventId}`);
  return <SignedOut />;
}
