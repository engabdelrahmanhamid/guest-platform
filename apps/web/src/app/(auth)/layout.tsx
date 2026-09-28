import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';

export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations('app');
  return (
    <main className="auth-shell">
      <div className="card">
        <p className="muted small">{t('name')}</p>
        {children}
      </div>
    </main>
  );
}
