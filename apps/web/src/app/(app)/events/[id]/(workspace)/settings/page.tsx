import { listMemberships, utcToLocal } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { EmptyState } from '@/components/empty-state';
import { EventForm } from '@/components/event-form';
import { ActionForm, Checkbox, Field, SubmitButton } from '@/components/forms';
import { Icon } from '@/components/icons';
import { loadEventView } from '@/lib/events';
import { initials, TIMEZONES } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { addStaffAction, staffChangeAction, updateEventAction } from '../../../actions';

export const metadata: Metadata = { title: 'إعدادات المناسبة' };

/** Event settings: details and timing, the reception team, and cancellation. Owner only. */
export default async function EventSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ saved?: string }>;
}) {
  const { id } = await params;
  const { saved } = await searchParams;
  const { principal, view } = await loadEventView(id);
  const t = await getTranslations();
  if (view.membership.role !== 'owner') {
    return (
      <EmptyState
        icon="shield"
        title={t('settings.ownerOnlyTitle')}
        body={t('settings.ownerOnlyBody')}
      />
    );
  }
  const e = view.event;
  const members = await listMemberships(getCoreContext(), principal.user.id, id);
  const owner = members.find((m) => m.role === 'owner');
  const staff = members.filter((m) => m.role === 'staff');
  const staffChange = staffChangeAction.bind(null, id);
  const canCancel = view.allowedActions.includes('cancel');
  const sections = [
    { id: 'details', icon: 'edit', label: t('settings.nav.details') },
    { id: 'team', icon: 'users', label: t('settings.nav.team') },
    ...(canCancel ? [{ id: 'danger', icon: 'ban', label: t('settings.nav.danger') }] : []),
  ] as const;

  return (
    <div className="settings">
      <nav className="settings-nav" aria-label={t('settings.navLabel')}>
        {sections.map((s) => (
          <a key={s.id} href={`#${s.id}`} className={s.id === 'danger' ? 'danger' : undefined}>
            <Icon name={s.icon} />
            {s.label}
          </a>
        ))}
      </nav>

      <div className="settings-body">
        {saved && (
          <p role="status" className="alert alert-ok">
            <Icon name="checkCircle" />
            <span className="grow">{t('settings.saved')}</span>
          </p>
        )}

        <section className="settings-section" id="details" aria-labelledby="details-h">
          <header>
            <h2 id="details-h">{t('settings.detailsTitle')}</h2>
            <p>{view.canEdit ? t('settings.detailsHint') : t('settings.lockedHint')}</p>
          </header>
          {view.canEdit ? (
            <div className="panel">
              <EventForm
                action={updateEventAction.bind(null, id)}
                cancelHref={`/events/${id}`}
                timingOpen
                timezones={
                  TIMEZONES.some((z) => z.value === e.timezone)
                    ? TIMEZONES
                    : [{ value: e.timezone, label: e.timezone }, ...TIMEZONES]
                }
                submitLabel={t('eventForm.save')}
                values={{
                  category: e.category,
                  type: e.type,
                  name: e.name,
                  startsAt: utcToLocal(e.startsAt, e.timezone),
                  endsAt: e.endsAt ? utcToLocal(e.endsAt, e.timezone) : '',
                  timezone: e.timezone,
                  city: e.city,
                  venueName: e.venueName,
                  address: e.address ?? '',
                  mapsUrl: e.mapsUrl ?? '',
                  description: e.description ?? '',
                  defaultAllowedCompanions: e.defaultAllowedCompanions,
                  autoOpenCheckin: e.autoOpenCheckin,
                  checkinOpensOffsetMin: e.checkinOpensOffsetMin,
                  assumedDurationMin: e.assumedDurationMin,
                  autoCloseCheckin: e.autoCloseCheckin,
                  checkinClosesOffsetMin: e.checkinClosesOffsetMin,
                  reopenWindowMin: e.reopenWindowMin,
                }}
              />
            </div>
          ) : (
            <p className="alert alert-neutral">
              <Icon name="info" />
              <span className="grow">{t('settings.locked')}</span>
            </p>
          )}
        </section>

        <section className="settings-section" id="team" aria-labelledby="team-h">
          <header>
            <h2 id="team-h">{t('staff.title')}</h2>
            <p>{t('settings.teamHint')}</p>
          </header>
          <div className="panel card-flush">
            <ul className="people">
              {owner && (
                <li>
                  <span className="person">
                    <span className="avatar">{initials(owner.displayName)}</span>
                    <span>
                      <span className="name">
                        {owner.displayName}
                        <span className="tag">{t('staff.owner')}</span>
                      </span>
                      <span className="sub">{t('staff.ownerHint')}</span>
                    </span>
                  </span>
                </li>
              )}
              {staff.map((m) => (
                <li key={m.id}>
                  <span className="person">
                    <span className="avatar avatar-muted">{initials(m.displayName)}</span>
                    <span>
                      <span className="name">
                        {m.displayName}
                        {m.isSupervisor && (
                          <span className="tag tag-brand">{t('staff.supervisor')}</span>
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
            {staff.length === 0 && (
              <div className="people-empty">
                <EmptyState
                  icon="users"
                  title={t('staff.emptyTitle')}
                  body={t('staff.empty')}
                  compact
                  headingLevel={3}
                />
              </div>
            )}
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
                      placeholder="05XXXXXXXX"
                      hint={t('staff.phoneHint')}
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
          </div>
        </section>

        {canCancel && (
          <section className="settings-section" id="danger" aria-labelledby="danger-h">
            <header>
              <h2 id="danger-h">{t('settings.dangerTitle')}</h2>
            </header>
            <div className="panel danger-zone danger-row">
              <div className="stack-sm">
                <strong>{t('overview.actions.cancel')}</strong>
                <p>{t('settings.cancelHint')}</p>
              </div>
              <Link href={`/events/${id}/cancel`} className="btn btn-danger">
                <Icon name="ban" />
                {t('overview.actions.cancel')}
              </Link>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
