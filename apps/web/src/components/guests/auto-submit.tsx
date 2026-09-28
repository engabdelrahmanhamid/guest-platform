'use client';

import { useEffect, useRef } from 'react';

/**
 * Enhances the filter form: on wide screens the filters show inline (the sheet is open), and
 * changing a select applies it at once. Without script the Apply button does the same.
 */
export function AutoSubmit() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const form = ref.current?.closest('form');
    const sheet = form?.querySelector('details');
    if (!form || !sheet) return;
    const wide = window.matchMedia('(min-width: 900px)');
    const sync = () => {
      if (wide.matches) sheet.open = true;
    };
    sync();
    wide.addEventListener('change', sync);
    const onChange = (e: Event) => {
      if (wide.matches && (e.target as HTMLElement).tagName === 'SELECT') form.requestSubmit();
    };
    form.addEventListener('change', onChange);
    return () => {
      wide.removeEventListener('change', sync);
      form.removeEventListener('change', onChange);
    };
  }, []);
  return <span ref={ref} hidden />;
}
