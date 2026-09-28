import { getInvitationPreview, isDomainError, passQrSvg } from '@gp/core';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { GuestExperience } from '@/components/invite/experience';
import { UUID } from '@/lib/guests';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'معاينة الدعوة', robots: { index: false } };

const SAMPLE_STATES = ['pending', 'confirmed', 'declined'] as const;
type SampleState = (typeof SAMPLE_STATES)[number];

/**
 * The owner's preview of the guest page: a real guest (read-only) or a sample guest in any answer
 * state. It never writes: the answer buttons are inert and nothing is counted as an open.
 */
export default async function InvitationPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const principal = await requirePrincipal();
  const t = await getTranslations('invite');
  const ctx = getCoreContext();
  const as: SampleState = (SAMPLE_STATES as readonly string[]).includes(sp.as ?? '')
    ? (sp.as as SampleState)
    : 'pending';
  const guestId = sp.guest && UUID.test(sp.guest) ? sp.guest : null;
  let view;
  try {
    view = await getInvitationPreview(ctx, principal.user.id, id, { guestId, as });
  } catch (err) {
    if (isDomainError(err, 'not_found') || isDomainError(err, 'forbidden')) notFound();
    throw err;
  }
  const qrSvg = view.pass?.display === 'valid' ? await passQrSvg(view.pass.token) : null;
  const embed = sp.embed === '1';
  const link = (state: SampleState) =>
    `/events/${id}/preview?as=${state}${embed ? '&embed=1' : ''}`;

  const banner = (
    <div className="inv-preview-bar" role="note">
      <strong>{t('previewLabel')}</strong>
      <span>
        {view.sample ? t('previewSample') : t('previewGuest', { name: view.guest?.fullName ?? '' })}
      </span>
      {view.sample && (
        <nav className="inv-preview-states" aria-label={t('previewStates')}>
          {SAMPLE_STATES.map((s) => (
            <a key={s} href={link(s)} aria-current={as === s ? 'page' : undefined}>
              {t(`previewState.${s}`)}
            </a>
          ))}
        </nav>
      )}
      {!embed && <span className="inv-preview-note">{t('previewBanner')}</span>}
    </div>
  );

  return (
    <GuestExperience view={view} respond={null} qrSvg={qrSvg} now={ctx.now()} banner={banner} />
  );
}
