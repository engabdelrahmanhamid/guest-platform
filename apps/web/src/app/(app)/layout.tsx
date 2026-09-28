import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { requirePrincipal } from '@/lib/session';
import { logoutAction } from '../(auth)/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const principal = await requirePrincipal();
  const t = await getTranslations();
  return (
    <>
      <header className="topbar">
        <div className="container">
          <Link href="/dashboard" className="brand">
            {t('app.name')}
          </Link>
          <nav className="nav">
            <Link href="/dashboard">{t('nav.dashboard')}</Link>
            {principal.user.platformRole === 'admin' && <Link href="/admin">{t('nav.admin')}</Link>}
            <form action={logoutAction} className="inline-form">
              <button type="submit" className="btn btn-link">
                {t('nav.logout')}
              </button>
            </form>
          </nav>
        </div>
      </header>
      <main className="page container">{children}</main>
    </>
  );
}
