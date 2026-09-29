import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import '../../styles/components.css';
import '../../styles/door.css';

/**
 * The door's pages (staff link, scanner): the shared components and the door's own styles,
 * without the product shell's navigation. Staff have no account, so nothing here assumes one.
 */
export function DoorShell({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}
