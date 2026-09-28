import { DASHBOARD_FILTERS, type DashboardFilter, listOwnedEvents } from '@gp/core';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, SubmitButton } from '@/components/forms';
import { StatusBadge } from '@/components/status-badge';
import { formatShortDateTime } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';
import { resendVerificationAction } from '../../(auth)/actions';

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
  const events = await listOwnedEvents(getCoreContext().db, principal.user.id, filter);

  return (
    <>
      {!principal.user.emailVerified && (
        <div className="card alert-warn">
          <p>{t('auth.verifyBanner')}</p>
          <ActionForm action={resendVerificationAction}>
            <div>
              <SubmitButton variant="secondary">{t('auth.verifyResend')}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      )}
      <div className="row spread">
        <div>
          <h1>{t('dashboard.greeting', { name: principal.user.fullName })}</h1>
          <p className="muted">{t('dashboard.subtitle')}</p>
        </div>
        <Link href="/events/new" className="btn btn-primary">
          {t('dashboard.createEvent')}
        </Link>
      </div>

      <nav className="tabs" aria-label={t('nav.dashboard')}>
        {DASHBOARD_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === 'all' ? '/dashboard' : `/dashboard?filter=${f}`}
            className="tab"
            aria-current={f === filter ? 'page' : undefined}
          >
            {t(`dashboard.filters.${f}`)}
          </Link>
        ))}
      </nav>

      <section className="card">
        {events.length === 0 ? (
          <p className="muted">
            {filter === 'all' ? t('dashboard.empty') : t('dashboard.emptyFiltered')}
          </p>
        ) : (
          <ul className="list">
            {events.map((e) => (
              <li key={e.id}>
                <Link href={`/events/${e.id}`} className="event-link">
                  <span>
                    <strong>{e.name}</strong>
                    <br />
                    <span className="muted small">
                      {t(`eventType.${e.type}`)} · {formatShortDateTime(e.startsAt, e.timezone)}
                    </span>
                  </span>
                  <StatusBadge status={e.status} disabled={e.disabledAt !== null} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
