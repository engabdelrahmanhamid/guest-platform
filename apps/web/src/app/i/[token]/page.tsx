import {
  getGuestPage,
  guardPublicRequest,
  isDomainError,
  isPublicToken,
  noteUnknownToken,
  passQrSvg,
} from '@gp/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { OpenBeacon } from '@/components/invite/beacon';
import { GuestExperience } from '@/components/invite/experience';
import { publicClient } from '@/lib/public';
import { getCoreContext } from '@/lib/server';
import { respondAction } from './actions';

export const dynamic = 'force-dynamic';

type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ saved?: string; e?: string }>;
};

// Link previews (WhatsApp and others) see only a generic title: never the guest's name, and
// nothing at all about an unpublished event.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('invite');
  return {
    title: { absolute: t('metaTitle') },
    description: t('metaDescription'),
    robots: { index: false, follow: false },
    referrer: 'origin',
    openGraph: { title: t('metaTitle'), description: t('metaDescription') },
  };
}

export default async function InvitationPage({ params, searchParams }: Props) {
  const { token } = await params;
  const { saved, e } = await searchParams;
  if (!isPublicToken(token)) notFound();
  const ctx = getCoreContext();
  const client = await publicClient();
  try {
    await guardPublicRequest(ctx.db, 'view', client, token, ctx.now());
  } catch (err) {
    if (isDomainError(err, 'rate_limited')) return <TooManyRequests />;
    throw err;
  }
  const view = await getGuestPage(ctx, token);
  if (!view) {
    await noteUnknownToken(ctx.db, client, ctx.now());
    notFound();
  }
  const qrSvg = view.pass?.token ? await passQrSvg(view.pass.token) : null;
  return (
    <>
      <GuestExperience
        view={view}
        respond={respondAction.bind(null, token)}
        qrSvg={qrSvg}
        now={ctx.now()}
        saved={saved ?? null}
        error={e ?? null}
      />
      {view.state !== 'unavailable' && <OpenBeacon token={token} />}
    </>
  );
}

async function TooManyRequests() {
  const t = await getTranslations('invite');
  return (
    <main className="inv inv--minimal inv--plain">
      <section className="inv-notice">
        <h1>{t('busyTitle')}</h1>
        <p>{t('busyBody')}</p>
      </section>
    </main>
  );
}
