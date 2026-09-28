import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { MfaForm } from '@/components/mfa-form';
import { requirePrincipal } from '@/lib/session';
import { beginMfaAction, confirmMfaAction } from '../actions';

export const metadata: Metadata = { title: 'التحقق بخطوتين' };

export default async function AdminMfaPage() {
  const principal = await requirePrincipal();
  if (principal.user.platformRole !== 'admin') redirect('/dashboard');
  if (principal.session.mfaVerified) redirect('/admin');
  const t = await getTranslations('auth');
  return (
    <section className="card center-card stack">
      <div className="success" style={{ padding: '0.5rem 0 0' }}>
        <span className="glyph">
          <Icon name="shield" />
        </span>
        <h1>{t('mfaTitle')}</h1>
      </div>
      <MfaForm
        enrolled={principal.user.totpEnabled}
        begin={beginMfaAction}
        confirm={confirmMfaAction}
      />
    </section>
  );
}
