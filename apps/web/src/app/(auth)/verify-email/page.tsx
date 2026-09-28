import { isDomainError, verifyEmail } from '@gp/core';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { getCoreContext } from '@/lib/server';

export const dynamic = 'force-dynamic';

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
    <>
      <h1>{t('auth.verifyTitle')}</h1>
      <p className={ok ? 'alert alert-ok' : 'alert alert-error'}>
        {ok ? t('auth.verifyDone') : t('auth.verifyFailed')}
      </p>
      <p>
        <Link href="/dashboard" className="btn btn-primary">
          {t('nav.dashboard')}
        </Link>
      </p>
    </>
  );
}
