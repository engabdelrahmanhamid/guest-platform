import { getDoorOverview, isDomainError } from '@gp/core';
import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { DoorShell } from '@/components/door/door-shell';
import { Scanner } from '@/components/door/scanner';
import { SignedOut } from '@/components/door/signed-out';
import { resolveDoorCaller } from '@/lib/door';
import { UUID } from '@/lib/guests';
import { getCoreContext } from '@/lib/server';
import {
  checkInAction,
  confirmAction,
  correctAction,
  guestAction,
  lookupAction,
  overviewAction,
  resendAction,
  revokeAction,
  searchAction,
  teamAction,
  signOutAction,
  walkInAction,
} from './actions';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('workspace.areas');
  return {
    title: { absolute: t('checkin') },
    robots: { index: false, follow: false },
    referrer: 'origin',
    appleWebApp: { capable: true, title: t('checkin'), statusBarStyle: 'default' },
  };
}

export const viewport: Viewport = { themeColor: '#0b3a31' };

/** The door: one screen for scanning, search, walk-ins and the live count. */
export default async function ScanPage({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  if (!UUID.test(eventId)) notFound();
  const caller = await resolveDoorCaller(eventId);
  if (!caller) return <SignedOut />;
  let overview;
  try {
    overview = await getDoorOverview(getCoreContext(), caller, eventId);
  } catch (err) {
    if (isDomainError(err)) return <SignedOut />;
    throw err;
  }
  const bind = <A extends unknown[], R>(fn: (eventId: string, ...a: A) => R) =>
    fn.bind(null, eventId) as (...a: A) => R;
  return (
    <DoorShell>
      <Scanner
        initial={overview}
        isStaff={caller.kind === 'staff'}
        actions={{
          overview: bind(overviewAction),
          lookup: bind(lookupAction),
          search: bind(searchAction),
          guest: bind(guestAction),
          checkIn: bind(checkInAction),
          correct: bind(correctAction),
          confirm: bind(confirmAction),
          walkIn: bind(walkInAction),
          team: bind(teamAction),
          resend: bind(resendAction),
          revoke: bind(revokeAction),
        }}
        signOut={signOutAction}
      />
    </DoorShell>
  );
}
