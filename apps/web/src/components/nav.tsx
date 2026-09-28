'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './icons';

export function MainNav({ items }: { items: { href: string; label: string; icon: IconName }[] }) {
  const path = usePathname();
  return (
    <nav className="mainnav" aria-label="القائمة الرئيسية">
      {items.map((item) => {
        const active =
          path === item.href ||
          path.startsWith(`${item.href}/`) ||
          (item.href === '/dashboard' && path.startsWith('/events'));
        return (
          <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}>
            <Icon name={item.icon} />
            <span className="label">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
