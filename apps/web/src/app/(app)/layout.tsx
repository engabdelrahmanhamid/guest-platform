import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { Brand } from '@/components/brand';
import { Icon } from '@/components/icons';
import { Menu } from '@/components/menu';
import { type NavItem, NavLinks } from '@/components/nav';
import { initials } from '@/lib/format';
import { getDevOutbox } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';
import { logoutAction } from '../(auth)/actions';

export const dynamic = 'force-dynamic';

/**
 * Authenticated shell. Desktop: a sidebar with product navigation and, separately, the account.
 * Phones: a slim top bar (brand + account menu) and a bottom navigation bar.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const principal = await requirePrincipal();
  const t = await getTranslations();
  const isAdmin = principal.user.platformRole === 'admin';
  const product: NavItem[] = [
    { href: '/dashboard', label: t('nav.dashboard'), icon: 'home' },
    { href: '/events', label: t('nav.events'), icon: 'calendar' },
  ];
  const admin: NavItem[] = [{ href: '/admin', label: t('nav.admin'), icon: 'shield' }];
  const bottom: NavItem[] = [
    product[0]!,
    { href: '/events/new', label: t('nav.create'), icon: 'plus', className: 'create' },
    product[1]!,
    ...(isAdmin ? admin : []),
  ];
  const { fullName, email } = principal.user;
  const logout = (
    <form action={logoutAction}>
      <button
        type="submit"
        className="icon-btn"
        aria-label={t('nav.logout')}
        title={t('nav.logout')}
      >
        <Icon name="logout" />
      </button>
    </form>
  );
  const devOutbox = getDevOutbox() !== null;

  return (
    <div className="app">
      <aside className="sidebar">
        <Brand name={t('app.name')} href="/dashboard" />
        <NavLinks items={product} label={t('nav.product')} variant="side" />
        {isAdmin && (
          <div className="navgroup">
            <span className="navgroup-title">{t('nav.platform')}</span>
            <NavLinks items={admin} label={t('nav.platform')} variant="side" />
          </div>
        )}
        <div className="sidebar-foot">
          {devOutbox && (
            <p className="devnote">
              {t('dev.banner')} <a href="/dev/outbox">{t('dev.outbox')}</a>
            </p>
          )}
          <div className="account">
            <span className="avatar" aria-hidden="true">
              {initials(fullName)}
            </span>
            <span className="who">
              <span>{fullName}</span>
              <span className="ltr">{email}</span>
            </span>
            {logout}
          </div>
        </div>
      </aside>

      <header className="mobilebar">
        <Brand name={t('app.name')} href="/dashboard" />
        <Menu
          label={t('nav.account')}
          summary={
            <span className="avatar" aria-hidden="true">
              {initials(fullName)}
            </span>
          }
        >
          <span className="who">
            <span>{fullName}</span>
            <span className="ltr">{email}</span>
          </span>
          <hr className="menu-sep" />
          {devOutbox && (
            <a className="menu-item" href="/dev/outbox">
              <Icon name="mail" />
              {t('dev.outbox')}
            </a>
          )}
          <form action={logoutAction}>
            <button type="submit">
              <Icon name="logout" />
              {t('nav.logout')}
            </button>
          </form>
        </Menu>
      </header>

      <div className="main">
        <main className="main-inner">{children}</main>
      </div>

      <NavLinks items={bottom} label={t('nav.product')} variant="bottom" />
    </div>
  );
}
