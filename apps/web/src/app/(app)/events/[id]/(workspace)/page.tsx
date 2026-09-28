import {
  guestSummary,
  listMemberships,
  listRecentEventActivity,
  TRANSITION_ACTIONS,
} from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EmptyState } from '@/components/empty-state';
import { EVENT_TYPE_ICONS, Icon, type IconName } from '@/components/icons';
import { loadEventView } from '@/lib/events';
import {
  formatCount,
  formatDate,
  formatDateTime,
  formatMinutes,
  formatShortDateTime,
  formatTime,
  timezoneLabel,
} from '@/lib/format';
import { getCoreContext } from '@/lib/server';

export const metadata: Metadata = { title: 'نظرة عامة' };

type ReadyState = 'done' | 'todo' | 'later';

/**
 * The event's control center: what is ready, the key facts, where the lifecycle stands and
 * what happened recently. Owners see everything; staff see the facts and the state only.
 */
export default async function EventOverviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ done?: string }>;
}) {
  const { id } = await params;
  const { done } = await searchParams;
  const { principal, view } = await loadEventView(id);
  const { event: e, times } = view;
  const t = await getTranslations();
  const isOwner = view.membership.role === 'owner';
  const ctx = getCoreContext();
  const [members, activity, guests] = isOwner
    ? await Promise.all([
        listMemberships(ctx, principal.user.id, id),
        listRecentEventActivity(ctx, principal.user.id, id),
        guestSummary(ctx, principal.user.id, id),
      ])
    : [[], [], null];
  const staff = members.filter((m) => m.role === 'staff');
  const tz = e.timezone;
  const base = `/events/${id}`;

  // Setup readiness only means something before the event runs.
  const showReadiness = isOwner && (e.status === 'draft' || e.status === 'active');
  const hasGuests = (guests?.active ?? 0) > 0;
  const readiness: { key: string; state: ReadyState; note: string; href?: string }[] = [
    { key: 'details', state: 'done', note: t('readiness.detailsNote') },
    {
      key: 'guests',
      state: hasGuests ? 'done' : 'todo',
      note: hasGuests
        ? t('readiness.guestsNote', { count: guests!.active })
        : t('readiness.guestsTodo'),
      ...(hasGuests ? {} : { href: `${base}/guests` }),
    },
    { key: 'invitation', state: 'later', note: t('readiness.later') },
    {
      key: 'team',
      state: staff.length > 0 ? 'done' : 'todo',
      note: staff.length > 0 ? t('staff.count', { count: staff.length }) : t('readiness.teamNote'),
      ...(staff.length === 0 && view.canManageMembers ? { href: `${base}/settings#team` } : {}),
    },
    {
      key: 'activate',
      state: e.status === 'draft' ? 'todo' : 'done',
      note: e.status === 'draft' ? t('readiness.activateNote') : t('readiness.activatedNote'),
    },
  ];
  const READY_ICON: Record<ReadyState, IconName> = { done: 'check', todo: 'plus', later: 'clock' };

  // Lifecycle track: the path this event has taken or will take.
  const path: string[] = e.cancelledAt
    ? ['draft', 'active', ...(e.liveAt ? ['live'] : []), 'cancelled', 'archived']
    : ['draft', 'active', 'live', 'completed', 'archived'];
  const at = path.indexOf(e.status);
  const now = stateNow(e, times, t);

  return (
    <div className="stack-lg">
      {done && (TRANSITION_ACTIONS as string[]).includes(done) && (
        <p role="status" className="alert alert-ok">
          <Icon name="checkCircle" />
          <span className="grow">{t(`overview.done.${done}`)}</span>
        </p>
      )}

      <div className="cc">
        <div className="cc-main">
          {showReadiness && (
            <section className="section" aria-labelledby="readiness-h">
              <div className="section-head">
                <h2 id="readiness-h">{t('readiness.title')}</h2>
                <span className="aside">{t('readiness.subtitle')}</span>
              </div>
              <ol className="readiness panel">
                {readiness.map((r) => (
                  <li key={r.key} data-state={r.state}>
                    <span className="mark">
                      <Icon name={READY_ICON[r.state]} />
                    </span>
                    <span className="what">
                      <strong>{t(`readiness.items.${r.key}`)}</strong>
                      <span>{r.note}</span>
                    </span>
                    {r.href ? (
                      <Link href={r.href} className="btn btn-secondary btn-sm">
                        {t('readiness.add')}
                      </Link>
                    ) : (
                      <span className="sr-only">{t(`readiness.state.${r.state}`)}</span>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {guests && (
            <section className="section" aria-labelledby="guests-h">
              <div className="section-head">
                <h2 id="guests-h">{t('overview.guestsTitle')}</h2>
                <Link href={`${base}/guests`} className="btn btn-link btn-sm">
                  {t('overview.guestsLink')}
                  <Icon name="arrow" />
                </Link>
              </div>
              <dl className="guest-stats guest-stats-3">
                <div>
                  <dt>{t('overview.guestsTotal')}</dt>
                  <dd>{formatCount(guests.total)}</dd>
                </div>
                <div>
                  <dt>{t('overview.guestsActive')}</dt>
                  <dd>{formatCount(guests.active)}</dd>
                </div>
                <div className="is-capacity">
                  <dt>{t('overview.guestsCapacity')}</dt>
                  <dd>{formatCount(guests.potentialCapacity)}</dd>
                  <p>{t('overview.guestsCapacityHint')}</p>
                </div>
              </dl>
            </section>
          )}

          <section className="section" aria-labelledby="facts-h">
            <div className="section-head">
              <h2 id="facts-h">{t('overview.details')}</h2>
              {view.canEdit && (
                <Link href={`${base}/settings`} className="btn btn-link btn-sm">
                  <Icon name="edit" />
                  {t('workspace.editDetails')}
                </Link>
              )}
            </div>
            <div className="facts-grid">
              <div className="fact">
                <Icon name="calendar" />
                <span className="k">{t('overview.when')}</span>
                <span className="v">{formatDate(e.startsAt, tz)}</span>
                <span className="s">
                  {formatTime(e.startsAt, tz)}
                  {e.endsAt && ` – ${formatTime(e.endsAt, tz)}`} · {timezoneLabel(tz)}
                </span>
              </div>
              <div className="fact">
                <Icon name="pin" />
                <span className="k">{t('overview.where')}</span>
                <span className="v">
                  {e.venueName}، {e.city}
                </span>
                <span className="s">
                  {e.address}
                  {e.address && e.mapsUrl && ' · '}
                  {e.mapsUrl && (
                    <a href={e.mapsUrl} target="_blank" rel="noopener noreferrer">
                      {t('overview.openMap')}
                    </a>
                  )}
                </span>
              </div>
              <div className="fact">
                <Icon name={EVENT_TYPE_ICONS[e.type] ?? 'sparkle'} />
                <span className="k">{t('overview.kind')}</span>
                <span className="v">{t(`eventType.${e.type}`)}</span>
                <span className="s">{t(`category.${e.category}`)}</span>
              </div>
              <div className="fact">
                <Icon name="users" />
                <span className="k">{t('overview.companions')}</span>
                <span className="v">
                  {e.defaultAllowedCompanions === 0
                    ? t('overview.noCompanions')
                    : t('overview.companionsValue', { count: e.defaultAllowedCompanions })}
                </span>
                <span className="s">{t('overview.companionsNote')}</span>
              </div>
              {!e.cancelledAt && (
                <div className="fact">
                  <Icon name="clock" />
                  <span className="k">{t('overview.checkinWindow')}</span>
                  <span className="v">
                    {formatTime(times.checkinOpensAt, tz)} – {formatTime(times.checkinClosesAt, tz)}
                  </span>
                  <span className="s">
                    {e.autoOpenCheckin
                      ? t('overview.autoBefore', { d: formatMinutes(e.checkinOpensOffsetMin) })
                      : t('overview.manualOpen')}
                  </span>
                </div>
              )}
              {isOwner && (
                <div className="fact">
                  <Icon name="user" />
                  <span className="k">{t('staff.title')}</span>
                  <span className="v">
                    {staff.length > 0 ? t('staff.count', { count: staff.length }) : t('staff.none')}
                  </span>
                  <span className="s">
                    <Link href={`${base}/settings#team`}>{t('overview.manageTeam')}</Link>
                  </span>
                </div>
              )}
            </div>
            {e.description && <p className="t-support">{e.description}</p>}
          </section>
        </div>

        <div className="cc-side">
          <section className="section" aria-labelledby="state-h">
            <div className="section-head">
              <h2 id="state-h">{t('overview.stateTitle')}</h2>
            </div>
            <div className="panel state-panel">
              <ol
                className={`track${e.cancelledAt ? ' is-stopped' : ''}`}
                style={{ gridTemplateColumns: `repeat(${path.length}, 1fr)` }}
                aria-label={t('overview.trackLabel')}
              >
                {path.map((s, i) => (
                  <li
                    key={s}
                    data-state={i < at ? 'done' : i === at ? 'current' : 'todo'}
                    aria-current={i === at ? 'step' : undefined}
                  >
                    {t(`status.${s}`)}
                  </li>
                ))}
              </ol>
              <div className="now">
                <strong>{now.title}</strong>
                {now.body && <p>{now.body}</p>}
              </div>
              {!e.cancelledAt && e.status !== 'archived' && (
                <dl className="review-list">
                  <dt>{t('overview.opensAt')}</dt>
                  <dd>{formatShortDateTime(times.checkinOpensAt, tz)}</dd>
                  <dt>{t('overview.startsAt')}</dt>
                  <dd>{formatShortDateTime(e.startsAt, tz)}</dd>
                  <dt>{t('overview.effectiveEnd')}</dt>
                  <dd>
                    {formatShortDateTime(times.effectiveEnd, tz)}
                    {!e.endsAt && (
                      <span className="note">
                        {t('overview.assumed', { d: formatMinutes(e.assumedDurationMin) })}
                      </span>
                    )}
                  </dd>
                  <dt>{t('overview.closesAt')}</dt>
                  <dd>{formatShortDateTime(times.checkinClosesAt, tz)}</dd>
                </dl>
              )}
              {view.canEdit && (
                <div className="actions">
                  <Link href={`${base}/settings#timing`} className="btn btn-secondary btn-sm">
                    <Icon name="clock" />
                    {t('overview.editTiming')}
                  </Link>
                </div>
              )}
            </div>
          </section>

          {isOwner && (
            <section className="section" aria-labelledby="activity-h">
              <div className="section-head">
                <h2 id="activity-h">{t('activity.title')}</h2>
              </div>
              {activity.length === 0 ? (
                <EmptyState icon="list" title={t('activity.empty')} compact headingLevel={3} />
              ) : (
                <ol className="activity panel">
                  {activity.map((a) => {
                    const key = `activity.types.${a.type.replaceAll('.', '_')}`;
                    return (
                      <li key={a.id}>
                        <span>
                          <span className="what">
                            {t.has(key) ? t(key, { name: a.memberName ?? '' }) : a.type}
                          </span>
                          <span className="when">
                            {formatShortDateTime(a.at, tz)}
                            {a.bySchedule && ` · ${t('activity.bySchedule')}`}
                          </span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

type Times = Awaited<ReturnType<typeof loadEventView>>['view']['times'];
type EventRow = Awaited<ReturnType<typeof loadEventView>>['view']['event'];

/** One sentence on where the event stands and what happens next without anyone acting. */
function stateNow(
  e: EventRow,
  times: Times,
  t: Awaited<ReturnType<typeof getTranslations>>,
): { title: string; body?: string } {
  const tz = e.timezone;
  switch (e.status) {
    case 'draft':
      return { title: t('overview.now.draft'), body: t('overview.draftHint') };
    case 'active':
      return {
        title: t('overview.now.active'),
        body: e.autoOpenCheckin
          ? t('overview.next.autoOpen', { when: formatDateTime(times.checkinOpensAt, tz) })
          : t('overview.next.manualOpen'),
      };
    case 'live':
      return {
        title: t('overview.now.live'),
        body:
          e.autoCloseCheckin && !e.reopenedAt
            ? t('overview.next.autoClose', { when: formatDateTime(times.checkinClosesAt, tz) })
            : t('overview.next.manualClose'),
      };
    case 'completed':
      return {
        title: t('overview.now.completed'),
        ...(times.reopenUntil && times.reopenUntil.getTime() > Date.now()
          ? {
              body: t('overview.next.reopenUntil', { when: formatDateTime(times.reopenUntil, tz) }),
            }
          : {}),
      };
    case 'cancelled':
      return { title: t('overview.now.cancelled'), body: t('overview.next.cancelled') };
    default:
      return { title: t('overview.now.archived'), body: t('overview.next.archived') };
  }
}
