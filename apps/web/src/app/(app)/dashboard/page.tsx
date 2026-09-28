import { listOwnedEvents } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { EventCard } from '@/components/event-card';
import { ActionForm, SubmitButton } from '@/components/forms';
import { EVENT_TYPE_ICONS, Icon } from '@/components/icons';
import { StatusBadge } from '@/components/status-badge';
import { byRelevance, featuredEvent } from '@/lib/event-list';
import { dateTile, formatDayMonth, formatTime } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';
import { resendVerificationAction } from '../../(auth)/actions';

export const metadata: Metadata = { title: 'الرئيسية' };

/** How many other events the dashboard lists before pointing to the events page. */
const RECENT_COUNT = 4;

export default async function DashboardPage() {
  const principal = await requirePrincipal();
  const t = await getTranslations();
  const all = await listOwnedEvents(getCoreContext().db, principal.user.id);
  const featured = featuredEvent(all);
  const others = all
    .filter((e) => e.id !== featured?.id)
    .sort(byRelevance)
    .slice(0, RECENT_COUNT);
  const firstName = principal.user.fullName.split(/\s+/)[0] ?? '';

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

      <div className="page-head">
        <div className="titles">
          <p className="t-overline">{t('dashboard.greeting', { name: firstName })}</p>
          <h1>{t('dashboard.title')}</h1>
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
          {featured && (
            <section aria-labelledby="featured-h">
              <Link href={`/events/${featured.id}`} className="featured">
                <span className="date-tile" aria-hidden="true">
                  <span className="m">{dateTile(featured.startsAt, featured.timezone).month}</span>
                  <span className="d">{dateTile(featured.startsAt, featured.timezone).day}</span>
                </span>
                <span className="stack-sm">
                  <span className="row-tight">
                    {featured.status === 'live' ? (
                      <StatusBadge status="live" />
                    ) : (
                      <span className="eyebrow">{t('dashboard.featuredNext')}</span>
                    )}
                  </span>
                  <h2 id="featured-h">{featured.name}</h2>
                  <span className="facts">
                    <span>
                      <Icon name={EVENT_TYPE_ICONS[featured.type] ?? 'sparkle'} />
                      {t(`eventType.${featured.type}`)}
                    </span>
                    <span>
                      <Icon name="calendar" />
                      {formatDayMonth(featured.startsAt, featured.timezone)} ·{' '}
                      {formatTime(featured.startsAt, featured.timezone)}
                    </span>
                    <span>
                      <Icon name="pin" />
                      {featured.city} · {featured.venueName}
                    </span>
                  </span>
                </span>
                <span className="go">
                  {t('dashboard.openEvent')}
                  <Icon name="arrow" />
                </span>
              </Link>
            </section>
          )}

          {others.length > 0 && (
            <section className="section" aria-labelledby="recent-h">
              <div className="section-head">
                <h2 id="recent-h">{t('dashboard.otherEvents')}</h2>
                <Link href="/events" className="btn btn-link btn-sm">
                  {t('dashboard.allEvents', { count: all.length })}
                  <Icon name="arrow" />
                </Link>
              </div>
              <ul className="event-list">
                {others.map((e) => (
                  <li key={e.id}>
                    <EventCard event={e} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
