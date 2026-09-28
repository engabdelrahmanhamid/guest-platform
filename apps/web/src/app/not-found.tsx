import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('statusPage');
  return (
    <main className="container status-page">
      <div className="stack center">
        <span className="code-big num">404</span>
        <h1>{t('notFoundTitle')}</h1>
        <p className="muted">{t('notFoundBody')}</p>
        <Link href="/" className="btn btn-primary">
          {t('home')}
        </Link>
      </div>
    </main>
  );
}
