import {
  adminListAudit,
  adminListEvents,
  adminListSettings,
  adminListUsers,
  SETTING_SCHEMAS,
  type SettingKey,
} from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Checkbox, SubmitButton } from '@/components/forms';
import { Icon, type IconName } from '@/components/icons';
import { StatusBadge } from '@/components/status-badge';
import { formatShortDateTime, initials } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { requireAdminPage } from '@/lib/session';
import { toggleEventAction, toggleUserAction, updateSettingAction } from './actions';

export const metadata: Metadata = { title: 'إدارة المنصة' };

const TABS: { key: string; icon: IconName }[] = [
  { key: 'settings', icon: 'settings' },
  { key: 'users', icon: 'users' },
  { key: 'events', icon: 'calendar' },
  { key: 'audit', icon: 'list' },
];

const DAY_KEYS: SettingKey[] = ['auto_archive.days', 'retention.guest_pii_days'];

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string }>;
}) {
  const principal = await requireAdminPage();
  const { tab: rawTab, q } = await searchParams;
  const tab = TABS.some((x) => x.key === rawTab) ? rawTab! : 'settings';
  const ctx = getCoreContext();
  const t = await getTranslations();

  return (
    <div className="stack-lg">
      <div className="page-head">
        <div className="titles">
          <p className="eyebrow">{t('admin.eyebrow')}</p>
          <h1>{t('admin.title')}</h1>
        </div>
        <span className="tag tag-brand">
          <Icon name="shield" />
          {t('admin.mfaOn')}
        </span>
      </div>

      <nav className="tabs" aria-label={t('admin.title')}>
        {TABS.map((x) => (
          <Link
            key={x.key}
            href={`/admin?tab=${x.key}`}
            className="tab"
            aria-current={x.key === tab ? 'page' : undefined}
          >
            <Icon name={x.icon} />
            {t(`admin.${x.key}`)}
          </Link>
        ))}
      </nav>

      {tab === 'settings' && <Settings />}
      {tab === 'users' && <Users />}
      {tab === 'events' && <Events />}
      {tab === 'audit' && <Audit />}
    </div>
  );

  async function Settings() {
    const settings = await adminListSettings(ctx, principal);
    const isBool = (key: SettingKey) => SETTING_SCHEMAS[key].safeParse(true).success;
    const groups: { title: string; keys: SettingKey[] }[] = [
      {
        title: t('admin.groupLifecycle'),
        keys: [
          'lifecycle.auto_open_checkin',
          'lifecycle.checkin_opens_offset_min',
          'lifecycle.assumed_duration_min',
          'lifecycle.auto_close_checkin',
          'lifecycle.checkin_closes_offset_min',
          'lifecycle.reopen_window_min',
        ],
      },
      { title: t('admin.groupRetention'), keys: ['auto_archive.days', 'retention.guest_pii_days'] },
    ];
    return (
      <>
        <p className="alert alert-info">
          <Icon name="info" />
          <span className="grow">{t('admin.settingsHint')}</span>
        </p>
        {groups.map((g) => (
          <section key={g.title} className="card card-flush">
            <div className="card-head card-head-pad">
              <h2>{g.title}</h2>
            </div>
            {g.keys.map((key) => {
              const labelKey = `admin.keys.${key}`;
              const descKey = `admin.desc.${key}`;
              return (
                <ActionForm key={key} action={updateSettingAction} className="setting">
                  <div>
                    <label htmlFor={`s-${key}`} className="label">
                      {t(labelKey)}
                    </label>
                    <p className="desc">{t(descKey)}</p>
                  </div>
                  <div className="row-tight">
                    <input type="hidden" name="key" value={key} />
                    {isBool(key) ? (
                      <Checkbox
                        name="value"
                        label={t('common.on')}
                        defaultChecked={settings[key] === true}
                      />
                    ) : (
                      <>
                        <input
                          id={`s-${key}`}
                          name="value"
                          type="number"
                          defaultValue={settings[key] === null ? '' : String(settings[key])}
                          placeholder={
                            SETTING_SCHEMAS[key].safeParse(null).success
                              ? t('admin.nullMeansOff')
                              : undefined
                          }
                        />
                        <span className="unit">
                          {DAY_KEYS.includes(key) ? t('common.days') : t('common.minutes')}
                        </span>
                      </>
                    )}
                    <SubmitButton variant="secondary" size="sm">
                      {t('common.save')}
                    </SubmitButton>
                  </div>
                </ActionForm>
              );
            })}
          </section>
        ))}
      </>
    );
  }

  async function Users() {
    const users = await adminListUsers(ctx, principal, q ? { search: q } : {});
    return (
      <section className="card card-flush">
        <form className="search" action="/admin">
          <input type="hidden" name="tab" value="users" />
          <input
            name="q"
            defaultValue={q}
            placeholder={t('admin.search')}
            aria-label={t('admin.search')}
          />
          <button type="submit" className="btn btn-secondary">
            <Icon name="search" />
            {t('admin.searchButton')}
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('admin.user')}</th>
                <th>{t('admin.role')}</th>
                <th>{t('admin.status')}</th>
                <th>{t('admin.joined')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <span className="person">
                      <span className="avatar">{initials(u.fullName)}</span>
                      <span>
                        <span className="name">{u.fullName}</span>
                        <span className="sub ltr">{u.email}</span>
                      </span>
                    </span>
                  </td>
                  <td>{u.platformRole === 'admin' ? t('admin.adminRole') : t('admin.userRole')}</td>
                  <td>
                    <span
                      className={u.status === 'active' ? 'tag tag-brand' : 'status status-disabled'}
                    >
                      {u.status === 'active' ? t('admin.statusActive') : t('admin.statusDisabled')}
                    </span>
                    {!u.emailVerifiedAt && <span className="note">{t('admin.unverified')}</span>}
                  </td>
                  <td className="subtle xs num">
                    {formatShortDateTime(u.createdAt, 'Asia/Riyadh')}
                  </td>
                  <td>
                    {u.id !== principal.user.id && (
                      <ActionForm action={toggleUserAction} className="inline-action">
                        <input type="hidden" name="userId" value={u.id} />
                        <input
                          type="hidden"
                          name="op"
                          value={u.status === 'active' ? 'disable' : 'enable'}
                        />
                        <input
                          name="reason"
                          placeholder={t('admin.reason')}
                          aria-label={t('admin.reason')}
                          maxLength={500}
                        />
                        <SubmitButton
                          variant={u.status === 'active' ? 'danger' : 'secondary'}
                          size="sm"
                        >
                          {u.status === 'active' ? t('admin.disable') : t('admin.enable')}
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {users.length === 0 && <p className="empty subtle">{t('admin.empty')}</p>}
        </div>
      </section>
    );
  }

  async function Events() {
    const events = await adminListEvents(ctx, principal);
    return (
      <section className="card card-flush">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('admin.event')}</th>
                <th>{t('admin.owner')}</th>
                <th>{t('admin.status')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    <strong>{e.name}</strong>
                    <span className="note num">{formatShortDateTime(e.startsAt, e.timezone)}</span>
                  </td>
                  <td className="ltr xs">{e.ownerEmail}</td>
                  <td>
                    <StatusBadge status={e.status} disabled={e.disabledAt !== null} />
                  </td>
                  <td>
                    <ActionForm action={toggleEventAction} className="inline-action">
                      <input type="hidden" name="eventId" value={e.id} />
                      <input type="hidden" name="op" value={e.disabledAt ? 'enable' : 'disable'} />
                      <input
                        name="reason"
                        placeholder={t('admin.reason')}
                        aria-label={t('admin.reason')}
                        maxLength={500}
                      />
                      <SubmitButton variant={e.disabledAt ? 'secondary' : 'danger'} size="sm">
                        {e.disabledAt ? t('admin.enable') : t('admin.disable')}
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && <p className="empty subtle">{t('admin.empty')}</p>}
        </div>
      </section>
    );
  }

  async function Audit() {
    const audit = await adminListAudit(ctx, principal, { limit: 50 });
    return (
      <section className="card card-flush">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('admin.when')}</th>
                <th>{t('admin.action')}</th>
                <th>{t('admin.target')}</th>
                <th>{t('admin.reason')}</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="xs num subtle">
                    {formatShortDateTime(a.createdAt, 'Asia/Riyadh')}
                  </td>
                  <td>
                    {t.has(`admin.actions.${a.action.replace('admin.', '')}`)
                      ? t(`admin.actions.${a.action.replace('admin.', '')}`)
                      : a.action}
                  </td>
                  <td>
                    {a.targetType === 'platform_setting' && t.has(`admin.keys.${a.targetId}`) ? (
                      t(`admin.keys.${a.targetId}`)
                    ) : (
                      <span className="code ltr">
                        {a.targetType} · {a.targetId.slice(0, 8)}
                      </span>
                    )}
                  </td>
                  <td className="small">{a.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && <p className="empty subtle">{t('admin.empty')}</p>}
        </div>
      </section>
    );
  }
}
