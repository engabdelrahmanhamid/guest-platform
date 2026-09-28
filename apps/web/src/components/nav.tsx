'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from './icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  /** Other path prefixes that belong to this item (e.g. /events/* for Events). */
  match?: string[];
  className?: string;
}

function isActive(path: string, item: NavItem): boolean {
  if (item.href === '/events/new') return path.startsWith('/events/new');
  const prefixes = [item.href, ...(item.match ?? [])];
  return prefixes.some(
    (p) => (path === p || path.startsWith(`${p}/`)) && !path.startsWith('/events/new'),
  );
}

/** Product navigation. Rendered as the desktop sidebar list and the phone bottom bar. */
export function NavLinks({
  items,
  label,
  variant,
}: {
  items: NavItem[];
  label: string;
  variant: 'side' | 'bottom';
}) {
  const path = usePathname();
  const links = items.map((item) => (
    <Link
      key={item.href}
      href={item.href}
      className={variant === 'side' ? 'navlink' : item.className}
      aria-current={isActive(path, item) ? 'page' : undefined}
    >
      <Icon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  ));
  return variant === 'side' ? (
    <nav className="navgroup" aria-label={label}>
      {links}
    </nav>
  ) : (
    <nav className="bottomnav" aria-label={label}>
      {links}
    </nav>
  );
}
