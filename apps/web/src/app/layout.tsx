import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactNode } from 'react';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';
import '../styles/shell.css';
import '../styles/pages.css';
import '../styles/guests.css';

const font = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'منصة الضيوف', template: '%s · منصة الضيوف' },
  robots: { index: false, follow: false },
};

// Arabic-first: RTL by default.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={font.variable}>
      <body>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
