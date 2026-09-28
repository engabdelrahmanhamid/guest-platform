import { listMemberships, TRANSITION_ACTIONS, type TransitionAction } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { ActionForm, Checkbox, Field, SubmitButton } from '@/components/forms';
import { EVENT_TYPE_ICONS, Icon, type IconName } from '@/components/icons';
import { StatusBadge } from '@/components/status-badge';
import { loadEventView } from '@/lib/events';
import {
  formatDate,
  formatDateTime,
  formatMinutes,
  formatTime,
  initials,
  timezoneLabel,
} from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { addStaffAction, staffChangeAction, transitionAction } from '../actions';

export const metadata: Metadata = { title: 'المناسبة' };

/** The forward action for each state is the primary button; the rest are secondary. */
const PRIMARY: Partial<Record<TransitionAction, true>> = {
  activate: true,
  start: true,
  complete: true,
};
const ACTION_ICON: Record<TransitionAction, IconName> = {
  activate: 'rocket',
  start: 'play',
  complete: 'stop',
  cancel: 'ban',
  archive: 'archive',
  reopen: 'refresh',
};

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
  const { event: e, times, allowedActions } = view;
  const t = await getTranslations();
  const isOwner = view.membership.role === 'owner';
  const members = isOwner ? await listMemberships(getCoreContext(), principal.user.id, id) : [];
  const owner = members.find((m) => m.role === 'owner');
  const staff = members.filter((m) => m.role === 'staff');
  const transition = transitionAction.bind(null, id);
  const staffChange = staffChangeAction.bind(null, id);
  const tz = e.timezone;
  // Check-in timing means nothing once an event is cancelled; it stays visible as history otherwise.
  const showTiming = !e.cancelledAt;

  // Lifecycle track: the path this event has taken or will take.
  const path: string[] = e.cancelledAt
    ? ['draft', 'active', ...(e.liveAt ? ['live'] : []), 'cancelled', 'archived']
    : ['draft', 'active', 'live', 'completed', 'archived'];
  const at = path.indexOf(e.status);
  const inlineActions = allowedActions.filter((a) => a !== 'cancel');
  const ordered = [
    ...inlineActions.filter((a) => PRIMARY[a]),
    ...inlineActions.filter((a) => !PRIMARY[a]),
  ];

  return (
    <div className="stack-lg">
      <nav className="crumbs">
        <Link href="/dashboard">{t('nav.dashboard')}</Link>
        <Icon name="chevronBack" />
        <span>{e.name}</span>
      </nav>

      {done && (TRANSITION_ACTIONS as string[]).includes(done) && (
        <p role="status" className="alert alert-ok">
          <Icon name="checkCircle" />
          <span className="grow">{t(`overview.done.${done}`)}</span>
        </p>
      )}
      {e.disabledAt && (
        <p className="alert alert-error">
          <Icon name="ban" />
          <span className="grow">
            {t('overview.disabledNotice', { reason: e.disabledReason ?? '' })}
          </span>
        </p>
      )}
      {e.cancelledAt && (
        <p className="alert alert-warn">
          <Icon name="alert" />
          <span className="grow">
            {t('overview.cancelledNotice', { reason: e.cancellationReason ?? '' })}
          </span>
        </p>
      )}

      <section className="card event-hero">
        <div className="title-row">
          <h1>{e.name}</h1>
          <StatusBadge status={e.status} disabled={e.disabledAt !== null} />
        </div>
        <div className="facts-inline">
          <span>
            <Icon name={EVENT_TYPE_ICONS[e.type] ?? 'sparkle'} />
            {t(`category.${e.category}`)} · {t(`eventType.${e.type}`)}
          </span>
          <span>
            <Icon name="calendar" />
            {formatDate(e.startsAt, tz)}
          </span>
          <span>
            <Icon name="clock" />
            {formatTime(e.startsAt, tz)}
            {e.endsAt && ` – ${formatTime(e.endsAt, tz)}`}
          </span>
          <span>
            <Icon name="pin" />
            {e.venueName}، {e.city}
          </span>
        </div>

        <ol
          className={`track${e.cancelledAt ? ' is-stopped' : ''}`}
          style={{ gridTemplateColumns: `repeat(${path.length}, 1fr)` }}
          aria-label={t('overview.trackLabel')}
        >
          {path.map((s, i) => (
            <li key={s} data-state={i < at ? 'done' : i === at ? 'current' : 'todo'}>
              {t(`status.${s}`)}
            </li>
          ))}
        </ol>

        {isOwner && (view.canEdit || allowedActions.length > 0) && (
          <div className="actionbar">
            <ActionForm action={transition} className="row">
              <input type="hidden" name="expectedStatus" value={e.status} />
              {ordered.map((a) => (
                <ConfirmSubmit
                  key={a}
                  name="action"
                  value={a}
                  confirm={t(`overview.confirm.${a}`)}
                  variant={PRIMARY[a] ? 'primary' : 'secondary'}
                >
                  <Icon name={ACTION_ICON[a]} />
                  {t(`overview.actions.${a}`)}
                </ConfirmSubmit>
              ))}
              {view.canEdit && (
                <Link href={`/events/${id}/edit`} className="btn btn-secondary">
                  <Icon name="edit" />
                  {t('overview.actions.edit')}
                </Link>
              )}
              {allowedActions.includes('cancel') && (
                <Link href={`/events/${id}/cancel`} className="btn btn-danger">
                  <Icon name="ban" />
                  {t('overview.actions.cancel')}
                </Link>
              )}
            </ActionForm>
            {e.status === 'draft' && (
              <p className="field-hint" style={{ flexBasis: '100%' }}>
                {t('overview.draftHint')}
              </p>
            )}
          </div>
        )}
      </section>

      <div className={showTiming ? 'grid-2' : 'stack-lg'}>
        <section className="card">
          <div className="card-head">
            <h2>
              <Icon name="info" />
              {t('overview.details')}
            </h2>
          </div>
          <dl className="facts">
            <dt>{t('overview.when')}</dt>
            <dd>
              <span>{formatDate(e.startsAt, tz)}</span>
              <span className="subtle small">
                {formatTime(e.startsAt, tz)}
                {e.endsAt && ` – ${formatTime(e.endsAt, tz)}`} · {timezoneLabel(tz)}
              </span>
            </dd>
            <dt>{t('overview.where')}</dt>
            <dd>
              <span>
                {e.venueName}، {e.city}
              </span>
              {e.address && <span className="subtle small">{e.address}</span>}
              {e.mapsUrl && (
                <a href={e.mapsUrl} target="_blank" rel="noopener noreferrer" className="small">
                  {t('overview.openMap')}
                </a>
              )}
            </dd>
            <dt>{t('overview.companions')}</dt>
            <dd>
              {e.defaultAllowedCompanions === 0
                ? t('overview.noCompanions')
                : t('overview.companionsValue', { count: e.defaultAllowedCompanions })}
            </dd>
            {e.description && (
              <>
                <dt>{t('eventForm.description')}</dt>
                <dd>{e.description}</dd>
              </>
            )}
          </dl>
        </section>

        {showTiming && (
          <section className="card">
            <div className="card-head">
              <h2>
                <Icon name="clock" />
                {t('overview.lifecycle')}
              </h2>
            </div>
            <ol className="timeline">
              <li>
                <span className="when">{t('overview.opensAt')}</span>
                <span>
                  {formatDateTime(times.checkinOpensAt, tz)}
                  <span className="how" style={{ display: 'block' }}>
                    {e.autoOpenCheckin
                      ? t('overview.autoBefore', { d: formatMinutes(e.checkinOpensOffsetMin) })
                      : t('overview.manualOpen')}
                  </span>
                </span>
              </li>
              <li>
                <span className="when">{t('overview.startsAt')}</span>
                <span>{formatDateTime(e.startsAt, tz)}</span>
              </li>
              <li>
                <span className="when">{t('overview.effectiveEnd')}</span>
                <span>
                  {formatDateTime(times.effectiveEnd, tz)}
                  {!e.endsAt && (
                    <span className="how" style={{ display: 'block' }}>
                      {t('overview.assumed', { d: formatMinutes(e.assumedDurationMin) })}
                    </span>
                  )}
                </span>
              </li>
              <li>
                <span className="when">{t('overview.closesAt')}</span>
                <span>
                  {formatDateTime(times.checkinClosesAt, tz)}
                  <span className="how" style={{ display: 'block' }}>
                    {e.autoCloseCheckin && !e.reopenedAt
                      ? t('overview.autoAfter', { d: formatMinutes(e.checkinClosesOffsetMin) })
                      : t('overview.manualClose')}
                  </span>
                </span>
              </li>
              {times.reopenUntil && e.status === 'completed' && (
                <li>
                  <span className="when">{t('overview.reopenUntil')}</span>
                  <span>{formatDateTime(times.reopenUntil, tz)}</span>
                </li>
              )}
            </ol>
          </section>
        )}
      </div>

      {isOwner && (
        <section className="card">
          <div className="card-head">
            <h2>
              <Icon name="users" />
              {t('staff.title')}
            </h2>
            {staff.length > 0 && (
              <span className="subtle small num">{t('staff.count', { count: staff.length })}</span>
            )}
          </div>
          <ul className="people">
            {owner && (
              <li>
                <span className="person">
                  <span className="avatar">{initials(owner.displayName)}</span>
                  <span>
                    <span className="name">
                      {owner.displayName}
                      <span className="badge badge-plain">{t('staff.owner')}</span>
                    </span>
                    <span className="sub">{t('staff.ownerHint')}</span>
                  </span>
                </span>
              </li>
            )}
            {staff.map((m) => (
              <li key={m.id}>
                <span className="person">
                  <span
                    className="avatar"
                    style={{ background: 'var(--surface-2)', color: 'var(--ink-2)' }}
                  >
                    {initials(m.displayName)}
                  </span>
                  <span>
                    <span className="name">
                      {m.displayName}
                      {m.isSupervisor && (
                        <span className="badge badge-supervisor">{t('staff.supervisor')}</span>
                      )}
                    </span>
                    <span className="sub">
                      {m.phoneE164 && <span className="ltr">{m.phoneE164}</span>}
                      {m.phoneE164 && m.status === 'invited' && ' · '}
                      {m.status === 'invited' && t('staff.invited')}
                    </span>
                  </span>
                </span>
                {view.canManageMembers && (
                  <ActionForm action={staffChange} className="person-actions">
                    <input type="hidden" name="membershipId" value={m.id} />
                    <ConfirmSubmit
                      name="op"
                      value={m.isSupervisor ? 'supervisor_off' : 'supervisor_on'}
                      variant="secondary"
                      size="sm"
                    >
                      {m.isSupervisor ? t('staff.removeSupervisor') : t('staff.makeSupervisor')}
                    </ConfirmSubmit>
                    <ConfirmSubmit
                      name="op"
                      value="remove"
                      variant="danger"
                      size="sm"
                      confirm={t('staff.confirmRemove', { name: m.displayName })}
                    >
                      {t('staff.remove')}
                    </ConfirmSubmit>
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          {staff.length === 0 && <p className="subtle small">{t('staff.empty')}</p>}
          {view.canManageMembers && (
            <div className="add-staff">
              <ActionForm action={addStaffAction.bind(null, id)}>
                <h3>{t('staff.add')}</h3>
                <div className="grid-2">
                  <Field
                    name="displayName"
                    label={t('staff.displayName')}
                    required
                    maxLength={80}
                  />
                  <Field
                    name="phone"
                    type="tel"
                    label={t('staff.phone')}
                    optional={t('common.optional')}
                    placeholder="05XXXXXXXX"
                  />
                </div>
                <Checkbox name="isSupervisor" label={t('staff.isSupervisorLong')} />
                <div className="row spread">
                  <SubmitButton variant="secondary">
                    <Icon name="plus" />
                    {t('staff.add')}
                  </SubmitButton>
                  <span className="field-hint">{t('staff.accessLater')}</span>
                </div>
              </ActionForm>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
