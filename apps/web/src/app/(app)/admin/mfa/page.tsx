import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MfaForm } from '@/components/mfa-form';
import { requirePrincipal } from '@/lib/session';
import { beginMfaAction, confirmMfaAction } from '../actions';

export default async function AdminMfaPage() {
  const principal = await requirePrincipal();
  if (principal.user.platformRole !== 'admin') redirect('/dashboard');
  if (principal.session.mfaVerified) redirect('/admin');
  const t = await getTranslations('auth');
  return (
    <section className="card" style={{ maxInlineSize: 480 }}>
      <h1>{t('mfaTitle')}</h1>
      <MfaForm
        enrolled={principal.user.totpEnabled}
        begin={beginMfaAction}
        confirm={confirmMfaAction}
      />
    </section>
  );
}
