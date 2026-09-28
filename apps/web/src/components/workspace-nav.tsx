'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { Icon, type IconName } from './icons';

export interface WorkspaceNavItem {
  href: string;
  label: string;
  icon: IconName;
  ready: boolean;
  /** Extra paths that belong to this area (e.g. the cancel page under Settings). */
  also?: string[];
}

/**
 * Event-level navigation. Scrolls sideways on narrow screens and keeps the current area in
 * view. Areas that are not built yet are marked with a small dot and a hidden "soon" label.
 */
export function WorkspaceNav({
  items,
  label,
  soonLabel,
}: {
  items: WorkspaceNavItem[];
  label: string;
  soonLabel: string;
}) {
  const path = usePathname();
  const ref = useRef<HTMLElement>(null);
  const activeHref = items.find(
    (i) => i.href === path || i.also?.some((a) => path.startsWith(a)),
  )?.href;

  useEffect(() => {
    ref.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeHref]);

  return (
    <nav className="ws-nav" aria-label={label} ref={ref}>
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.href === activeHref ? 'page' : undefined}
        >
          <Icon name={item.icon} />
          {item.label}
          {!item.ready && (
            <>
              <span className="soon-dot" aria-hidden="true" />
              <span className="sr-only">({soonLabel})</span>
            </>
          )}
        </Link>
      ))}
    </nav>
  );
}
