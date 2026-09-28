import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Guest Platform',
  robots: { index: false, follow: false },
};

// Arabic-first: RTL by default. Locale switching arrives with i18n in phase 1.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <body>{children}</body>
    </html>
  );
}
