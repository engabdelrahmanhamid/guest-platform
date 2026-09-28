import {
  type EventRow,
  formatPhone,
  getGuest,
  isDomainError,
  listGuestActivity,
  MAX_GROUPS_PER_EVENT,
} from '@gp/core';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { Drawer } from '@/components/drawer';
import { ActionForm, Field, SubmitButton, TextArea } from '@/components/forms';
import { GuestForm } from '@/components/guests/guest-form';
import { Icon } from '@/components/icons';
import { formatShortDateTime } from '@/lib/format';
import { type GuestsParams, guestsHref, UUID } from '@/lib/guests';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';
import { addGuestAction, groupAction, guestStatusAction, updateGuestAction } from './actions';

type Group = { id: string; name: string; sortOrder: number; guestCount: number };
type T = Awaited<ReturnType<typeof getTranslations>>;

/** Whichever drawer the URL asks for: add, groups, or one guest (view, edit, cancel). */
export async function GuestPanels({
  eventId,
  params,
  groups,
  editable,
  event,
}: {
  eventId: string;
  params: GuestsParams;
  groups: Group[];
  editable: boolean;
  event: EventRow;
}) {
  const t = await getTranslations();
  const base = `/events/${eventId}/guests`;
  const close = guestsHref(base, params, { guest: null, panel: null, log: null });
  const closeLabel = t('guests.drawer.close');

  if (params.panel === 'add' && editable) {
    return (
      <Drawer title={t('guests.form.addTitle')} closeHref={close} closeLabel={closeLabel}>
        <GuestForm
          action={addGuestAction.bind(null, eventId)}
          mode="add"
          groups={groups}
          defaultCompanions={event.defaultAllowedCompanions}
          returnTo={close}
          cancelHref={close}
        />
      </Drawer>
    );
  }
  if (params.panel === 'groups') {
    return (
      <Drawer
        title={t('guests.groups.title')}
        subtitle={t('guests.groups.intro')}
        closeHref={close}
        closeLabel={closeLabel}
      >
        <GroupsPanel eventId={eventId} groups={groups} editable={editable} t={t} />
      </Drawer>
    );
  }
  if (!params.guest || !UUID.test(params.guest)) return null;

  const principal = await requirePrincipal();
  const ctx = getCoreContext();
  let guest;
  try {
    guest = await getGuest(ctx, principal.user.id, eventId, params.guest);
  } catch (err) {
    if (isDomainError(err, 'not_found')) return null;
    throw err;
  }
  const self = guestsHref(base, params, { panel: null, log: null });

  if (params.panel === 'edit' && editable) {
    return (
      <Drawer
        title={t('guests.form.editTitle')}
        subtitle={guest.fullName}
        closeHref={self}
        closeLabel={closeLabel}
      >
        <GuestForm
          action={updateGuestAction.bind(null, eventId, guest.id)}
          mode="edit"
          groups={groups}
          defaultCompanions={event.defaultAllowedCompanions}
          returnTo={self}
          cancelHref={self}
          values={{
            fullName: guest.fullName,
            phone: guest.phoneOriginal ?? guest.phoneE164 ?? '',
            email: guest.email ?? '',
            groupId: guest.groupId ?? '',
            allowedCompanions: String(guest.allowedCompanions),
            notes: guest.notes ?? '',
          }}
        />
      </Drawer>
    );
  }

  const statusAction = guestStatusAction.bind(null, eventId, guest.id);
  if (params.panel === 'cancel' && editable && guest.status === 'active') {
    return (
      <Drawer
        title={t('guests.drawer.cancelTitle')}
        subtitle={guest.fullName}
        closeHref={self}
        closeLabel={closeLabel}
      >
        <ActionForm action={statusAction}>
          <input type="hidden" name="returnTo" value={self} />
          <p className="t-support">{t('guests.drawer.cancelBody')}</p>
          <TextArea
            name="reason"
            label={t('guests.drawer.cancelReasonLabel')}
            hint={t('guests.drawer.cancelReasonHint')}
            rows={2}
            maxLength={300}
          />
          <div className="form-actions">
            <button type="submit" name="op" value="cancel" className={buttonClass('danger-solid')}>
              <Icon name="ban" />
              {t('guests.drawer.cancelConfirm')}
            </button>
            <Link href={self} scroll={false} className={buttonClass('ghost')}>
              {t('common.back')}
            </Link>
          </div>
        </ActionForm>
      </Drawer>
    );
  }

  // View
  const logLimit = Math.min(Math.max(Number(params.log) || 20, 20), 200);
  const log = await listGuestActivity(ctx, principal.user.id, eventId, guest.id, {
    limit: logLimit,
  });
  const groupNames = new Map(groups.map((g) => [g.id, g.name]));
  const tz = event.timezone;
  const phoneShown = formatPhone(guest.phoneE164);
  const typedDiffers =
    guest.phoneOriginal &&
    guest.phoneOriginal.replace(/\s/g, '') !== guest.phoneE164?.replace(/\s/g, '');

  return (
    <Drawer
      title={guest.fullName}
      subtitle={
        <span className="row-tight">
          <span className={`gstatus gstatus-${guest.status}`}>
            {t(`guests.status.${guest.status}`)}
          </span>
          <span className="src">
            <Icon name={guest.source === 'excel_import' ? 'file' : 'edit'} />
            {t(`guests.source.${guest.source}`)}
          </span>
        </span>
      }
      closeHref={close}
      closeLabel={closeLabel}
      footer={
        editable && (
          <ActionForm action={statusAction} className="drawer-actions">
            <input type="hidden" name="returnTo" value={self} />
            <Link
              href={guestsHref(base, params, { panel: 'edit', log: null })}
              scroll={false}
              className={buttonClass('primary')}
            >
              <Icon name="edit" />
              {t('guests.drawer.edit')}
            </Link>
            {guest.status === 'active' ? (
              <Link
                href={guestsHref(base, params, { panel: 'cancel', log: null })}
                scroll={false}
                className={buttonClass('secondary')}
              >
                <Icon name="ban" />
                {t('guests.drawer.cancelGuest')}
              </Link>
            ) : (
              <ConfirmSubmit
                name="op"
                value="restore"
                variant="secondary"
                confirm={t('guests.drawer.restoreConfirm')}
              >
                <Icon name="undo" />
                {t('guests.drawer.restore')}
              </ConfirmSubmit>
            )}
            <span className="grow" />
            <ConfirmSubmit
              name="op"
              value="delete"
              variant="danger"
              size="sm"
              confirm={t('guests.drawer.deleteConfirm')}
            >
              <Icon name="trash" />
              {t('guests.drawer.delete')}
            </ConfirmSubmit>
          </ActionForm>
        )
      }
    >
      {guest.status === 'cancelled' && guest.cancelledAt && (
        <p className="alert alert-neutral">
          <Icon name="ban" />
          <span className="grow">
            <strong>
              {t('guests.drawer.cancelledOn', { when: formatShortDateTime(guest.cancelledAt, tz) })}
            </strong>
            {guest.cancelReason && (
              <span className="block">
                {t('guests.drawer.cancelReason', { reason: guest.cancelReason })}
              </span>
            )}
          </span>
        </p>
      )}

      <section className="drawer-section" aria-labelledby="gd-identity">
        <h3 id="gd-identity">{t('guests.drawer.identity')}</h3>
        <dl className="kv">
          <dt>{t('guests.form.phone')}</dt>
          <dd>
            <span dir="ltr" className="num">
              {phoneShown}
            </span>
            {typedDiffers && (
              <span className="note">
                {t('guests.drawer.phoneTyped', { value: '' })}
                <span dir="ltr">{guest.phoneOriginal}</span>
              </span>
            )}
          </dd>
          <dt>{t('guests.drawer.email')}</dt>
          <dd>
            {guest.email ? (
              <span dir="ltr">{guest.email}</span>
            ) : (
              <span className="muted">{t('guests.drawer.none')}</span>
            )}
          </dd>
          <dt>{t('guests.drawer.group')}</dt>
          <dd>{guest.groupName ?? <span className="muted">{t('guests.noGroup')}</span>}</dd>
          <dt>{t('guests.drawer.notes')}</dt>
          <dd className="pre">
            {guest.notes ?? <span className="muted">{t('guests.drawer.none')}</span>}
          </dd>
        </dl>
      </section>

      <section className="drawer-section" aria-labelledby="gd-settings">
        <h3 id="gd-settings">{t('guests.drawer.settings')}</h3>
        <dl className="kv">
          <dt>{t('guests.drawer.companions')}</dt>
          <dd>
            {t('guests.companionsLabel', { count: guest.allowedCompanions })}
            <span className="note">
              {t('guests.drawer.partySize', { count: 1 + guest.allowedCompanions })}
            </span>
          </dd>
        </dl>
        <p className="later-note">
          <Icon name="clock" />
          {t('guests.drawer.later')}
        </p>
      </section>

      <section className="drawer-section" aria-labelledby="gd-activity">
        <h3 id="gd-activity">{t('guests.drawer.activity')}</h3>
        <ol className="timeline">
          {log.items.map((a) => (
            <li key={a.id}>
              <span className="what">{activityText(t, a.type, a.data, groupNames)}</span>
              <span className="when">
                {formatShortDateTime(a.at, tz)}
                {a.byName && ` · ${t('guests.activity.by', { name: a.byName })}`}
              </span>
            </li>
          ))}
        </ol>
        {log.more && (
          <Link
            href={guestsHref(base, params, { log: String(logLimit + 20) })}
            scroll={false}
            className={buttonClass('link', 'sm')}
          >
            {t('guests.drawer.olderActivity')}
          </Link>
        )}
      </section>
    </Drawer>
  );
}

/** One timeline line. Entries hold ids and field names only; names come from current data. */
function activityText(
  t: T,
  type: string,
  data: Record<string, unknown>,
  groups: Map<string, string>,
): string {
  const g = (id: unknown) =>
    typeof id === 'string'
      ? (groups.get(id) ?? t('guests.activity.deletedGroup'))
      : t('guests.noGroup');
  const bulk = data.bulk ? ` · ${t('guests.activity.bulk')}` : '';
  switch (type) {
    case 'guest.created': {
      const text =
        data.source === 'excel_import'
          ? t('guests.activity.created_excel_import', { row: String(data.row ?? '') })
          : t('guests.activity.created_manual');
      return data.duplicateAcknowledged
        ? `${text} · ${t('guests.activity.duplicateAcknowledged')}`
        : text;
    }
    case 'guest.updated': {
      const fields = Array.isArray(data.fields) ? (data.fields as string[]) : [];
      const names = fields.map((f) =>
        t.has(`guests.activity.fields.${f}`) ? t(`guests.activity.fields.${f}`) : f,
      );
      const text = t('guests.activity.updated', { fields: names.join('، ') });
      return data.duplicateAcknowledged
        ? `${text} · ${t('guests.activity.duplicateAcknowledged')}`
        : text;
    }
    case 'guest.group_changed':
      if (data.reason === 'group_deleted')
        return t('guests.activity.groupDeleted', { from: g(data.from) });
      if (data.to === null) return t('guests.activity.groupRemoved', { from: g(data.from) }) + bulk;
      return t('guests.activity.groupChanged', { to: g(data.to) }) + bulk;
    case 'guest.companion_allowance_changed':
      return (
        t('guests.activity.companions', { from: String(data.from), to: String(data.to) }) + bulk
      );
    case 'guest.cancelled':
      return t('guests.activity.cancelled') + bulk;
    case 'guest.restored':
      return t('guests.activity.restored');
    case 'guest.deleted':
      return t('guests.activity.deleted');
    default:
      return type;
  }
}

function GroupsPanel({
  eventId,
  groups,
  editable,
  t,
}: {
  eventId: string;
  groups: Group[];
  editable: boolean;
  t: T;
}) {
  const action = groupAction.bind(null, eventId);
  return (
    <div className="stack">
      {groups.length === 0 ? (
        <p className="muted">{t('guests.groups.empty')}</p>
      ) : (
        <ul className="group-list">
          {groups.map((g, i) => (
            <li key={g.id}>
              {editable ? (
                <ActionForm action={action} className="group-row">
                  <input type="hidden" name="groupId" value={g.id} />
                  <label htmlFor={`g-${g.id}`} className="sr-only">
                    {t('guests.groups.name')}
                  </label>
                  <input
                    id={`g-${g.id}`}
                    name="name"
                    defaultValue={g.name}
                    maxLength={60}
                    className="group-name"
                  />
                  <span className="group-meta">
                    {t('guests.groups.guests', { count: g.guestCount })}
                  </span>
                  <span className="group-ops">
                    <button
                      type="submit"
                      name="op"
                      value="rename"
                      className={buttonClass('secondary', 'sm')}
                    >
                      {t('guests.groups.rename')}
                    </button>
                    <button
                      type="submit"
                      name="op"
                      value="up"
                      className="icon-btn"
                      aria-label={t('guests.groups.up')}
                      disabled={i === 0}
                    >
                      <Icon name="arrowUp" />
                    </button>
                    <button
                      type="submit"
                      name="op"
                      value="down"
                      className="icon-btn"
                      aria-label={t('guests.groups.down')}
                      disabled={i === groups.length - 1}
                    >
                      <Icon name="arrowDown" />
                    </button>
                    <ConfirmSubmit
                      name="op"
                      value="delete"
                      variant="danger"
                      size="sm"
                      confirm={t('guests.groups.deleteConfirm', { name: g.name })}
                    >
                      <Icon name="trash" />
                      {t('guests.groups.delete')}
                    </ConfirmSubmit>
                  </span>
                </ActionForm>
              ) : (
                <div className="group-row">
                  <strong>{g.name}</strong>
                  <span className="group-meta">
                    {t('guests.groups.guests', { count: g.guestCount })}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && groups.length < MAX_GROUPS_PER_EVENT && (
        <ActionForm action={action} className="form group-add">
          <Field name="name" label={t('guests.groups.name')} maxLength={60} required />
          <SubmitButton variant="secondary">
            <Icon name="plus" />
            {t('guests.groups.add')}
          </SubmitButton>
          <input type="hidden" name="op" value="create" />
        </ActionForm>
      )}
      <p className="field-hint">{t('guests.groups.limit', { n: MAX_GROUPS_PER_EVENT })}</p>
    </div>
  );
}
