import { DASHBOARD_FILTERS, type DashboardFilter, listOwnedEvents } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, SubmitButton } from '@/components/forms';
import { EVENT_TYPE_ICONS, Icon } from '@/components/icons';
import { StatusBadge } from '@/components/status-badge';
import { dateTile, formatTime } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';
import { resendVerificationAction } from '../../(auth)/actions';

export const metadata: Metadata = { title: 'مناسباتي' };

/** Live first, then upcoming events soonest first, then the rest most recent first. */
const RANK: Record<string, number> = { live: 0, active: 1, draft: 1 };
const byRelevance = (
  a: { status: string; startsAt: Date },
  b: { status: string; startsAt: Date },
) => {
  const ra = RANK[a.status] ?? 2;
  const rb = RANK[b.status] ?? 2;
  if (ra !== rb) return ra - rb;
  const diff = a.startsAt.getTime() - b.startsAt.getTime();
  return ra === 2 ? -diff : diff;
};

const inFilter = (status: string, filter: DashboardFilter) =>
  filter === 'all' || status === filter || (filter === 'active' && status === 'live');

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const principal = await requirePrincipal();
  const t = await getTranslations();
  const { filter: raw } = await searchParams;
  const filter: DashboardFilter = (DASHBOARD_FILTERS as readonly string[]).includes(raw ?? '')
    ? (raw as DashboardFilter)
    : 'all';
  const all = await listOwnedEvents(getCoreContext().db, principal.user.id);
  const events = all.filter((e) => inFilter(e.status, filter)).sort(byRelevance);
  const firstName = principal.user.fullName.split(/\s+/)[0];

  return (
    <div className="stack-lg">
      {!principal.user.emailVerified && (
        <div className="alert alert-warn">
          <Icon name="mail" />
          <div className="grow">
            <strong>{t('auth.verifyBannerTitle')}</strong>
            <p>{t('auth.verifyBanner')}</p>
          </div>
          <ActionForm action={resendVerificationAction} className="row">
            <SubmitButton variant="secondary" size="sm">
              {t('auth.verifyResend')}
            </SubmitButton>
          </ActionForm>
        </div>
      )}

      <div className="page-head" style={{ marginBlockEnd: 0 }}>
        <div>
          <h1>{t('dashboard.greeting', { name: firstName ?? '' })}</h1>
          <p className="lead">{t('dashboard.subtitle')}</p>
        </div>
        {all.length > 0 && (
          <Link href="/events/new" className="btn btn-primary">
            <Icon name="plus" />
            {t('dashboard.createEvent')}
          </Link>
        )}
      </div>

      {all.length === 0 ? (
        <div className="card empty">
          <span className="glyph">
            <Icon name="calendar" />
          </span>
          <h2>{t('dashboard.emptyTitle')}</h2>
          <p>{t('dashboard.empty')}</p>
          <Link href="/events/new" className="btn btn-primary">
            <Icon name="plus" />
            {t('dashboard.createFirst')}
          </Link>
        </div>
      ) : (
        <div>
          <nav className="tabs" aria-label={t('dashboard.filterLabel')}>
            {DASHBOARD_FILTERS.map((f) => (
              <Link
                key={f}
                href={f === 'all' ? '/dashboard' : `/dashboard?filter=${f}`}
                className="tab"
                aria-current={f === filter ? 'page' : undefined}
              >
                {t(`dashboard.filters.${f}`)}
                <span className="count num">{all.filter((e) => inFilter(e.status, f)).length}</span>
              </Link>
            ))}
          </nav>

          {events.length === 0 ? (
            <div className="card empty">
              <p>{t('dashboard.emptyFiltered')}</p>
            </div>
          ) : (
            <div className="event-grid">
              {events.map((e) => {
                const tile = dateTile(e.startsAt, e.timezone);
                const over = ['completed', 'cancelled', 'archived'].includes(e.status);
                return (
                  <Link
                    key={e.id}
                    href={`/events/${e.id}`}
                    className={`event-card${over ? ' is-muted' : ''}`}
                  >
                    <span className="date-tile" aria-hidden>
                      <span className="m" style={{ display: 'block' }}>
                        {tile.month}
                      </span>
                      <span className="d" style={{ display: 'block' }}>
                        {tile.day}
                      </span>
                    </span>
                    <span className="body">
                      <h3>{e.name}</h3>
                      <span className="meta">
                        <span>
                          <Icon name={EVENT_TYPE_ICONS[e.type] ?? 'sparkle'} />
                          {t(`eventType.${e.type}`)}
                        </span>
                        <span>
                          <Icon name="clock" />
                          {formatTime(e.startsAt, e.timezone)}
                        </span>
                        <span>
                          <Icon name="pin" />
                          {e.city}
                        </span>
                      </span>
                      <span style={{ marginBlockStart: '0.35rem' }}>
                        <StatusBadge status={e.status} disabled={e.disabledAt !== null} />
                      </span>
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
