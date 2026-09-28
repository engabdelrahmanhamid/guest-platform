import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { loadEventView } from '@/lib/events';

export default async function EventCreatedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadEventView(id);
  const t = await getTranslations('created');
  return (
    <section className="card" style={{ textAlign: 'center' }}>
      <p style={{ fontSize: '2.5rem', margin: 0 }} aria-hidden>
        🎉
      </p>
      <h1>{t('title')}</h1>
      <p>
        <strong>{view.event.name}</strong>
      </p>
      <p className="muted">{t('body')}</p>
      <div className="row" style={{ justifyContent: 'center' }}>
        <Link href={`/events/${id}`} className="btn btn-primary">
          {t('open')}
        </Link>
        <Link href="/dashboard" className="btn btn-secondary">
          {t('dashboard')}
        </Link>
      </div>
    </section>
  );
}
