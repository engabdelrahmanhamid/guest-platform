import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { Icon, type IconName } from '@/components/icons';
import { MainNav } from '@/components/nav';
import { initials } from '@/lib/format';
import { getDevOutbox } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';
import { logoutAction } from '../(auth)/actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: ReactNode }) {
  const principal = await requirePrincipal();
  const t = await getTranslations();
  const items: { href: string; label: string; icon: IconName }[] = [
    { href: '/dashboard', label: t('nav.dashboard'), icon: 'calendar' },
  ];
  if (principal.user.platformRole === 'admin') {
    items.push({ href: '/admin', label: t('nav.admin'), icon: 'shield' });
  }
  return (
    <>
      {getDevOutbox() && (
        <div className="devbar">
          <div className="container">
            <span>{t('dev.banner')}</span>
            <a href="/dev/outbox">{t('dev.outbox')}</a>
          </div>
        </div>
      )}
      <header className="topbar">
        <div className="container topbar-inner">
          <Brand name={t('app.name')} href="/dashboard" />
          <MainNav items={items} />
          <div className="usermenu">
            <span className="avatar" aria-hidden>
              {initials(principal.user.fullName)}
            </span>
            <span className="who">
              <span>{principal.user.fullName}</span>
              <span className="ltr">{principal.user.email}</span>
            </span>
            <form action={logoutAction}>
              <button
                type="submit"
                className="icon-btn"
                title={t('nav.logout')}
                aria-label={t('nav.logout')}
              >
                <Icon name="logout" />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="page container">{children}</main>
      <footer className="footer">
        <div className="container row spread">
          <span>{t('app.name')}</span>
          <span>{t('app.tagline')}</span>
        </div>
      </footer>
    </>
  );
}
