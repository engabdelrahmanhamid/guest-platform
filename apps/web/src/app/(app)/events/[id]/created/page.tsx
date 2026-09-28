import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon } from '@/components/icons';
import { StatusBadge } from '@/components/status-badge';
import { CreateStepper } from '@/components/stepper';
import { loadEventView } from '@/lib/events';
import { formatDate, formatTime, timezoneLabel } from '@/lib/format';

export const metadata: Metadata = { title: 'مراجعة المناسبة' };

/** Create, step 3: the event exists as a draft; review it and see what comes next. */
export default async function EventCreatedPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadEventView(id);
  const e = view.event;
  const tz = e.timezone;
  const t = await getTranslations();
  const steps = ['next1', 'next2', 'next3'] as const;
  return (
    <div className="wizard">
      <CreateStepper current={3} />
      <div className="success">
        <span className="glyph">
          <Icon name="check" />
        </span>
        <h1>{t('created.title')}</h1>
        <p className="t-support">{t('created.body')}</p>
      </div>

      <section className="panel stack" aria-labelledby="review-h">
        <div className="section-head">
          <h2 id="review-h">{e.name}</h2>
          <StatusBadge status={e.status} />
        </div>
        <dl className="review-list">
          <dt>{t('overview.kind')}</dt>
          <dd>
            {t(`category.${e.category}`)} · {t(`eventType.${e.type}`)}
          </dd>
          <dt>{t('overview.when')}</dt>
          <dd>
            {formatDate(e.startsAt, tz)} · {formatTime(e.startsAt, tz)}
            {e.endsAt && ` – ${formatTime(e.endsAt, tz)}`}
            <span className="note">{timezoneLabel(tz)}</span>
          </dd>
          <dt>{t('overview.where')}</dt>
          <dd>
            {e.venueName}، {e.city}
          </dd>
          <dt>{t('overview.companions')}</dt>
          <dd>
            {e.defaultAllowedCompanions === 0
              ? t('overview.noCompanions')
              : t('overview.companionsValue', { count: e.defaultAllowedCompanions })}
          </dd>
        </dl>
      </section>

      <section className="stack-sm" aria-labelledby="next-h">
        <h2 id="next-h" className="t-label">
          {t('created.nextTitle')}
        </h2>
        <ol className="next-steps">
          {steps.map((s) => (
            <li key={s}>
              <Icon name="checkCircle" />
              {t(`created.${s}`)}
            </li>
          ))}
        </ol>
      </section>

      <div className="form-actions">
        <Link href={`/events/${id}`} className="btn btn-primary">
          {t('created.open')}
          <Icon name="arrow" />
        </Link>
        <Link href={`/events/${id}/settings`} className="btn btn-secondary">
          <Icon name="edit" />
          {t('workspace.editDetails')}
        </Link>
      </div>
    </div>
  );
}
