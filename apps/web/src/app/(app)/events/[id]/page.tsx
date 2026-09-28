import { listMemberships, TRANSITION_ACTIONS } from '@gp/core';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { ActionForm, Checkbox, Field, SubmitButton } from '@/components/forms';
import { StatusBadge } from '@/components/status-badge';
import { loadEventView } from '@/lib/events';
import { formatDateTime } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { addStaffAction, staffChangeAction, transitionAction } from '../actions';

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
  const staff = members.filter((m) => m.role === 'staff');
  const fmt = (d: Date | null) => (d ? formatDateTime(d, e.timezone) : t('common.notSet'));
  const transition = transitionAction.bind(null, id);
  const staffChange = staffChangeAction.bind(null, id);
  // Cancelling needs a reason, so it has its own page.
  const inlineActions = allowedActions.filter((a) => a !== 'cancel');

  return (
    <>
      <div className="row spread">
        <div>
          <h1>{e.name}</h1>
          <p className="muted">
            {t(`category.${e.category}`)} · {t(`eventType.${e.type}`)}
          </p>
        </div>
        <StatusBadge status={e.status} disabled={e.disabledAt !== null} />
      </div>

      {done && (TRANSITION_ACTIONS as string[]).includes(done) && (
        <p role="status" className="alert alert-ok">
          {t(`overview.done.${done}`)}
        </p>
      )}
      {e.disabledAt && (
        <p className="alert alert-error">
          {t('overview.disabledNotice', { reason: e.disabledReason ?? '' })}
        </p>
      )}
      {e.cancelledAt && (
        <p className="alert alert-warn">
          {t('overview.cancelledNotice', { reason: e.cancellationReason ?? '' })}
        </p>
      )}

      {isOwner && (view.canEdit || allowedActions.length > 0) && (
        <section className="card">
          <ActionForm action={transition}>
            <input type="hidden" name="expectedStatus" value={e.status} />
            <div className="row">
              {view.canEdit && (
                <Link href={`/events/${id}/edit`} className="btn btn-secondary">
                  {t('overview.actions.edit')}
                </Link>
              )}
              {inlineActions.map((a) => (
                <ActionButton
                  key={a}
                  action={a}
                  label={t(`overview.actions.${a}`)}
                  confirm={t(`overview.confirm.${a}`)}
                />
              ))}
              {allowedActions.includes('cancel') && (
                <Link href={`/events/${id}/cancel`} className="btn btn-danger">
                  {t('overview.actions.cancel')}
                </Link>
              )}
            </div>
          </ActionForm>
        </section>
      )}

      <div className="grid-2">
        <section className="card">
          <h2>{t('overview.details')}</h2>
          <dl className="facts">
            <dt>{t('overview.when')}</dt>
            <dd>
              {fmt(e.startsAt)}
              {e.endsAt && (
                <>
                  <br />
                  <span className="muted small">
                    {t('overview.effectiveEnd')}: {fmt(e.endsAt)}
                  </span>
                </>
              )}
              <br />
              <span className="muted small ltr">{e.timezone}</span>
            </dd>
            <dt>{t('overview.where')}</dt>
            <dd>
              {e.venueName}، {e.city}
              {e.address && (
                <>
                  <br />
                  <span className="muted small">{e.address}</span>
                </>
              )}
              {e.mapsUrl && (
                <>
                  <br />
                  <a href={e.mapsUrl} target="_blank" rel="noopener noreferrer">
                    {t('overview.openMap')}
                  </a>
                </>
              )}
            </dd>
            <dt>{t('overview.companions')}</dt>
            <dd>{e.defaultAllowedCompanions}</dd>
          </dl>
          {e.description && <p className="muted">{e.description}</p>}
        </section>

        <section className="card">
          <h2>{t('overview.lifecycle')}</h2>
          <dl className="facts">
            <dt>{t('overview.opensAt')}</dt>
            <dd>
              {fmt(times.checkinOpensAt)}
              <br />
              <span className="muted small">
                {e.autoOpenCheckin ? t('overview.automatic') : t('overview.manual')}
              </span>
            </dd>
            <dt>{t('overview.effectiveEnd')}</dt>
            <dd>{fmt(times.effectiveEnd)}</dd>
            <dt>{t('overview.closesAt')}</dt>
            <dd>
              {fmt(times.checkinClosesAt)}
              <br />
              <span className="muted small">
                {e.autoCloseCheckin && !e.reopenedAt
                  ? t('overview.automatic')
                  : t('overview.manual')}
              </span>
            </dd>
            {times.reopenUntil && e.status === 'completed' && (
              <>
                <dt>{t('overview.reopenUntil')}</dt>
                <dd>{fmt(times.reopenUntil)}</dd>
              </>
            )}
          </dl>
        </section>
      </div>

      {isOwner && (
        <section className="card">
          <h2>{t('staff.title')}</h2>
          <ul className="list">
            {members
              .filter((m) => m.role === 'owner')
              .map((m) => (
                <li key={m.id} className="row spread">
                  <span>{m.displayName}</span>
                  <span className="badge">{t('staff.owner')}</span>
                </li>
              ))}
            {staff.map((m) => (
              <li key={m.id} className="row spread">
                <span>
                  {m.displayName}{' '}
                  {m.isSupervisor && (
                    <span className="badge badge-active">{t('staff.supervisor')}</span>
                  )}
                  <br />
                  <span className="muted small">
                    {m.phoneE164 && <span className="ltr">{m.phoneE164}</span>}
                    {m.status === 'invited' && ` · ${t('staff.invited')}`}
                  </span>
                </span>
                {view.canManageMembers && (
                  <ActionForm action={staffChange} className="row">
                    <input type="hidden" name="membershipId" value={m.id} />
                    <button
                      type="submit"
                      name="op"
                      value={m.isSupervisor ? 'supervisor_off' : 'supervisor_on'}
                      className="btn btn-secondary"
                    >
                      {m.isSupervisor ? t('staff.removeSupervisor') : t('staff.makeSupervisor')}
                    </button>
                    <RemoveButton
                      label={t('staff.remove')}
                      confirm={t('staff.confirmRemove', { name: m.displayName })}
                    />
                  </ActionForm>
                )}
              </li>
            ))}
          </ul>
          {staff.length === 0 && <p className="muted">{t('staff.empty')}</p>}
          {view.canManageMembers && (
            <>
              <h3>{t('staff.add')}</h3>
              <ActionForm action={addStaffAction.bind(null, id)}>
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
                    label={`${t('staff.phone')} (${t('common.optional')})`}
                  />
                </div>
                <Checkbox name="isSupervisor" label={t('staff.isSupervisor')} />
                <div>
                  <SubmitButton variant="secondary">{t('staff.add')}</SubmitButton>
                </div>
              </ActionForm>
              <p className="muted small">{t('staff.accessLater')}</p>
            </>
          )}
        </section>
      )}
    </>
  );
}

function ActionButton({
  action,
  label,
  confirm,
}: {
  action: string;
  label: string;
  confirm: string;
}) {
  return (
    <ConfirmSubmit
      name="action"
      value={action}
      confirm={confirm}
      variant={action === 'archive' ? 'secondary' : 'primary'}
    >
      {label}
    </ConfirmSubmit>
  );
}

function RemoveButton({ label, confirm }: { label: string; confirm: string }) {
  return (
    <ConfirmSubmit name="op" value="remove" confirm={confirm} variant="danger">
      {label}
    </ConfirmSubmit>
  );
}
