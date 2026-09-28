'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useRef } from 'react';
import { Icon } from './icons';

/**
 * A side panel opened by the URL (so it survives reloads and the back button). It slides in
 * from the reading-end side on wide screens and fills the screen on phones. Escape and the
 * backdrop close it by navigating to `closeHref`.
 */
export function Drawer({
  title,
  subtitle,
  closeHref,
  closeLabel,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  closeHref: string;
  closeLabel: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(e.target as HTMLElement).closest('.confirm-box')) {
        router.push(closeHref, { scroll: false });
      }
    };
    document.addEventListener('keydown', onKey);
    document.body.classList.add('has-drawer');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('has-drawer');
      previous?.focus?.();
    };
  }, [closeHref, router]);

  return (
    <div className="drawer-root">
      <Link
        href={closeHref}
        scroll={false}
        className="drawer-backdrop"
        aria-label={closeLabel}
        tabIndex={-1}
      />
      <div
        ref={panel}
        className={`drawer${wide ? ' drawer-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
      >
        <header className="drawer-head">
          <div className="grow">
            <h2 id="drawer-title">{title}</h2>
            {subtitle && <div className="drawer-sub">{subtitle}</div>}
          </div>
          <Link href={closeHref} scroll={false} className="icon-btn" aria-label={closeLabel}>
            <Icon name="x" />
          </Link>
        </header>
        <div className="drawer-body">{children}</div>
        {footer && <footer className="drawer-foot">{footer}</footer>}
      </div>
    </div>
  );
}
