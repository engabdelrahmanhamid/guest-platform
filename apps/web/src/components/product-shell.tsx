import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import '../styles/components.css';
import '../styles/shell.css';
import '../styles/pages.css';
import '../styles/guests.css';
import '../styles/invitations.css';
import '../styles/checkin.css';

/**
 * Styles and client-side messages for the product UI (owners, admins, sign-in). Guest-facing
 * invitation pages don't use it, so they stay small.
 */
export function ProductShell({ children }: { children: ReactNode }) {
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}
