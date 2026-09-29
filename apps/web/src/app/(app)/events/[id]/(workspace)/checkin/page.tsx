import { getLiveAttendance, listTeamAccess } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/button';
import { AutoRefresh } from '@/components/door/auto-refresh';
import { TeamAccess } from '@/components/door/team-access';
import { EmptyState } from '@/components/empty-state';
import { Icon } from '@/components/icons';
import { loadEventView } from '@/lib/events';
import { formatCount, formatShortDateTime, formatTime } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { revokeAccessAction, sendAccessAction } from './actions';

export const metadata: Metadata = { title: 'الاستقبال' };

/**
 * The owner's door dashboard: live counts, arrivals as they happen, and the door team with
 * their access links and signed-in devices.
 */
export default async function CheckinPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal, view } = await loadEventView(id);
  if (view.membership.role !== 'owner') notFound();
  const e = view.event;
  const ctx = getCoreContext();
  const t = await getTranslations('checkin');
  const td = await getTranslations('door');
  const [live, team] = await Promise.all([
    getLiveAttendance(ctx, principal.user.id, id),
    listTeamAccess(ctx, principal.user.id, id),
  ]);
  const tz = e.timezone;
  const { totals } = live;
  const status = e.status;
  const doorOpen = !e.disabledAt && (status === 'active' || status === 'live');
  const people = (n: number) => td('people', { count: n });
  const pct = totals.expectedPeople
    ? Math.min(100, Math.round((totals.invitedCheckedIn / totals.expectedPeople) * 100))
    : 0;
  const paceMax = Math.max(1, ...live.pace.map((p) => p.people));
  const notice =
    status === 'completed'
      ? view.times.reopenUntil && ctx.now() <= view.times.reopenUntil
        ? t('notice.completed', { time: formatShortDateTime(view.times.reopenUntil, tz) })
        : t('notice.completedLocked')
      : status === 'active'
        ? t('notice.active', { time: formatShortDateTime(live.checkinOpensAt, tz) })
        : status === 'live'
          ? null
          : t(`notice.${status}`);

  return (
    <div className="stack-lg checkin-page">
      {status === 'live' && <AutoRefresh seconds={15} />}
      <div className="page-head">
        <div className="titles">
          <h2 className="t-title">{t('title')}</h2>
          <p className="t-support">
            {t('subtitle')}
            {status === 'live' && (
              <span className="live-dot">
                <span aria-hidden="true" />
                {t('autoRefresh')}
              </span>
            )}
          </p>
        </div>
        {doorOpen && (
          <Link href={`/scan/${id}`} className={buttonClass('primary')}>
            <Icon name="scan" />
            {t('openScanner')}
          </Link>
        )}
      </div>

      {notice && (
        <p className="alert alert-neutral">
          <Icon name="info" />
          <span className="grow">{notice}</span>
        </p>
      )}

      <section className="panel ci-totals" aria-label={t('totals.label')}>
        <div className="ci-hero">
          <span className="ci-hero-n">{formatCount(totals.checkedInPeople)}</span>
          <span className="ci-hero-label">
            <strong>{t('totals.inside')}</strong>
            <span>{t('totals.ofExpected', { expected: formatCount(totals.expectedPeople) })}</span>
          </span>
          <span className="ci-bar" role="img" aria-label={`${pct}%`}>
            <span style={{ inlineSize: `${pct}%` }} />
          </span>
        </div>
        <dl className="ci-stats">
          <div>
            <dt>{t('totals.invited')}</dt>
            <dd>{formatCount(totals.invitedCheckedIn)}</dd>
          </div>
          <div>
            <dt>{t('totals.walkIns')}</dt>
            <dd>{formatCount(totals.walkInPeople)}</dd>
          </div>
          <div className="is-ok">
            <dt>{t('totals.complete')}</dt>
            <dd>{formatCount(totals.complete)}</dd>
          </div>
          <div className="is-warn">
            <dt>{t('totals.partial')}</dt>
            <dd>{formatCount(totals.partial)}</dd>
          </div>
          <div>
            <dt>{t('totals.notArrived')}</dt>
            <dd>{formatCount(totals.notArrived)}</dd>
          </div>
          <div>
            <dt>{t('totals.pending')}</dt>
            <dd>{formatCount(totals.pendingGuests)}</dd>
          </div>
        </dl>
      </section>

      <div className="ci-grid">
        <section className="panel" aria-labelledby="recent-h">
          <h3 id="recent-h" className="t-card">
            {t('recent.title')}
          </h3>
          {live.recent.length === 0 ? (
            <p className="muted small">{t('recent.empty')}</p>
          ) : (
            <ol className="ci-feed">
              {live.recent.map((r) => (
                <li key={r.id}>
                  <time>{formatTime(r.at, tz)}</time>
                  <span className="grow">
                    <Link href={`/events/${id}/guests?guest=${r.guestId}`}>{r.guestName}</Link>
                    <span className="sub">
                      {r.action !== 'check_in' && (
                        <span className="tag">{t(`recent.${r.action}`)}</span>
                      )}
                      {t('recent.by', { name: r.by })}
                    </span>
                  </span>
                  <span className={`ci-delta ${r.delta < 0 ? 'is-neg' : ''}`} dir="ltr">
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <div className="stack">
          <section className="panel" aria-labelledby="pace-h">
            <h3 id="pace-h" className="t-card">
              {t('pace.title')}
            </h3>
            <p className="field-hint">{t('pace.hint')}</p>
            {live.pace.length === 0 ? (
              <p className="muted small">{t('pace.empty')}</p>
            ) : (
              <ul className="ci-pace">
                {live.pace.map((p) => (
                  <li key={p.at.toISOString()}>
                    <time>{formatTime(p.at, tz)}</time>
                    <span className="ci-pace-bar">
                      <span style={{ inlineSize: `${(Math.max(0, p.people) / paceMax) * 100}%` }} />
                    </span>
                    <span className="n">{p.people}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {live.byMember.length > 0 && (
            <section className="panel" aria-labelledby="bymember-h">
              <h3 id="bymember-h" className="t-card">
                {t('byMember.title')}
              </h3>
              <ul className="ci-members">
                {live.byMember.map((m) => (
                  <li key={m.membershipId}>
                    <span className="grow">{m.name}</span>
                    <span className="n">{people(m.admitted)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      <section className="panel" aria-labelledby="team-h" id="team">
        <div className="section-head">
          <h3 id="team-h" className="t-card">
            {t('team.title')}
          </h3>
          <p className="field-hint">{t('team.hint')}</p>
        </div>
        {!doorOpen && team.length > 0 && <p className="muted small">{t('team.closed')}</p>}
        {team.length === 0 ? (
          <EmptyState
            icon="users"
            title={t('team.empty')}
            body={t('team.emptyBody')}
            headingLevel={3}
            action={
              <Link href={`/events/${id}/settings#team`} className={buttonClass('secondary')}>
                {t('team.manage')}
              </Link>
            }
          />
        ) : (
          <ul className="ci-team">
            {team.map((m) => {
              const hasAccess = m.linkPendingSince !== null || m.devices.length > 0;
              return (
                <li key={m.membershipId}>
                  <div className="ci-team-who">
                    <strong>{m.displayName}</strong>
                    {m.isSupervisor && (
                      <span className="tag tag-accent">{t('team.supervisor')}</span>
                    )}
                    {m.admitted > 0 && (
                      <span className="muted small">
                        {t('team.admitted', { people: td('peopleOf', { count: m.admitted }) })}
                      </span>
                    )}
                  </div>
                  <ul className="ci-devices">
                    {m.devices.map((d) => (
                      <li key={d.id}>
                        <Icon name="phone" />
                        {t('team.device', {
                          device: d.label ?? t('team.unknownDevice'),
                          since: formatShortDateTime(d.since, tz),
                        })}
                        <span className="muted">
                          {' · '}
                          {t('team.lastSeen', { time: formatTime(d.lastSeenAt, tz) })}
                        </span>
                      </li>
                    ))}
                    {m.linkPendingSince && (
                      <li>
                        <Icon name="clock" />
                        {t('team.linkPending', {
                          time: formatShortDateTime(m.linkPendingSince, tz),
                        })}
                      </li>
                    )}
                    {!hasAccess && (
                      <li className="muted">
                        <Icon name="link" />
                        {t('team.noAccess')}
                      </li>
                    )}
                  </ul>
                  <TeamAccess
                    membershipId={m.membershipId}
                    name={m.displayName}
                    hasAccess={hasAccess}
                    canSend={doorOpen}
                    send={sendAccessAction.bind(null, id, e.name)}
                    revoke={revokeAccessAction.bind(null, id)}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
