import { isDomainError, verifyEmail } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { getCoreContext } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'تأكيد البريد الإلكتروني' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const t = await getTranslations();
  let ok = false;
  if (token) {
    try {
      await verifyEmail(getCoreContext(), token);
      ok = true;
    } catch (err) {
      if (!isDomainError(err, 'invalid_token')) throw err;
    }
  }
  return (
    <div className="success">
      <span className={ok ? 'glyph' : 'glyph is-error'}>
        <Icon name={ok ? 'checkCircle' : 'alert'} />
      </span>
      <h1>{t('auth.verifyTitle')}</h1>
      <p className="muted">{ok ? t('auth.verifyDone') : t('auth.verifyFailed')}</p>
      <Link href="/dashboard" className="btn btn-primary btn-block">
        {t('nav.dashboard')}
      </Link>
    </div>
  );
}
