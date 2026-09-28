'use client';

import { type ReactNode, useEffect, useRef } from 'react';

/**
 * A disclosure menu built on <details>, so it works without script and with the keyboard.
 * Script adds closing on outside click and Escape.
 */
export function Menu({
  label,
  summary,
  summaryClassName,
  children,
}: {
  /** Accessible name of the toggle. */
  label: string;
  summary: ReactNode;
  summaryClassName?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onDown = (e: PointerEvent) => {
      if (el.open && !el.contains(e.target as Node)) el.open = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && el.open) {
        el.open = false;
        el.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);
  return (
    <details className="menu" ref={ref}>
      <summary className={summaryClassName} aria-label={label} title={label}>
        {summary}
      </summary>
      <div className="menu-panel">{children}</div>
    </details>
  );
}
