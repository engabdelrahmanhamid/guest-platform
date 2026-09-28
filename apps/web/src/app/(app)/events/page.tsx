import { listOwnedEvents } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { EventCard } from '@/components/event-card';
import { Icon } from '@/components/icons';
import { byRelevance, EVENT_FILTERS, inFilter, parseEventFilter } from '@/lib/event-list';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

export const metadata: Metadata = { title: 'المناسبات' };

/** Every event the user owns, filtered by status. */
export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string }>;
}) {
  const principal = await requirePrincipal();
  const t = await getTranslations();
  const filter = parseEventFilter((await searchParams).filter);
  const all = await listOwnedEvents(getCoreContext().db, principal.user.id);
  const events = all.filter((e) => inFilter(e.status, filter)).sort(byRelevance);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="titles">
          <h1>{t('events.title')}</h1>
          <p className="lead">{t('events.subtitle')}</p>
        </div>
        {all.length > 0 && (
          <Link href="/events/new" className="btn btn-primary">
            <Icon name="plus" />
            {t('dashboard.createEvent')}
          </Link>
        )}
      </div>

      {all.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="calendar"
            title={t('dashboard.emptyTitle')}
            body={t('dashboard.empty')}
            action={
              <Link href="/events/new" className="btn btn-primary">
                <Icon name="plus" />
                {t('dashboard.createFirst')}
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <nav className="segmented" aria-label={t('events.filterLabel')}>
            {EVENT_FILTERS.map((f) => (
              <Link
                key={f}
                href={f === 'all' ? '/events' : `/events?filter=${f}`}
                aria-current={f === filter ? 'page' : undefined}
              >
                {t(`events.filters.${f}`)}
                <span className="count num">{all.filter((e) => inFilter(e.status, f)).length}</span>
              </Link>
            ))}
          </nav>
          {events.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon="search"
                title={t('events.emptyFiltered', { filter: t(`events.filters.${filter}`) })}
                compact
                action={
                  <Link href="/events" className="btn btn-secondary btn-sm">
                    {t('events.showAll')}
                  </Link>
                }
              />
            </div>
          ) : (
            <ul className="event-list">
              {events.map((e) => (
                <li key={e.id}>
                  <EventCard event={e} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
