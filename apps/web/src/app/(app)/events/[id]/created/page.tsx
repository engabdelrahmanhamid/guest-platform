import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { CreateStepper } from '@/components/stepper';
import { loadEventView } from '@/lib/events';
import { formatDateTime } from '@/lib/format';

export const metadata: Metadata = { title: 'تم إنشاء المناسبة' };

export default async function EventCreatedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadEventView(id);
  const t = await getTranslations('created');
  const steps = ['next1', 'next2', 'next3'] as const;
  return (
    <div className="card" style={{ maxInlineSize: 820, marginInline: 'auto' }}>
      <CreateStepper current={3} />
      <div className="success">
        <span className="glyph">
          <Icon name="check" />
        </span>
        <div className="stack" style={{ gap: '0.35rem' }}>
          <h1>{t('title')}</h1>
          <p className="muted">
            <strong style={{ color: 'var(--ink)' }}>{view.event.name}</strong> ·{' '}
            {formatDateTime(view.event.startsAt, view.event.timezone)}
          </p>
          <p className="muted">{t('body')}</p>
        </div>
        <ol className="next-steps">
          {steps.map((s, i) => (
            <li key={s}>
              <span className="n num">{i + 1}</span>
              {t(s)}
            </li>
          ))}
        </ol>
        <div className="row" style={{ justifyContent: 'center' }}>
          <Link href={`/events/${id}`} className="btn btn-primary">
            {t('open')}
          </Link>
          <Link href="/dashboard" className="btn btn-secondary">
            {t('dashboard')}
          </Link>
        </div>
      </div>
    </div>
  );
}
