import {
  adminListAudit,
  adminListEvents,
  adminListSettings,
  adminListUsers,
  SETTING_SCHEMAS,
  type SettingKey,
} from '@gp/core';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Checkbox, Field, SubmitButton } from '@/components/forms';
import { StatusBadge } from '@/components/status-badge';
import { formatShortDateTime } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { requireAdminPage } from '@/lib/session';
import { toggleEventAction, toggleUserAction, updateSettingAction } from './actions';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const principal = await requireAdminPage();
  const { q } = await searchParams;
  const ctx = getCoreContext();
  const [settings, users, events, audit] = await Promise.all([
    adminListSettings(ctx, principal),
    adminListUsers(ctx, principal, q ? { search: q } : {}),
    adminListEvents(ctx, principal),
    adminListAudit(ctx, principal, { limit: 30 }),
  ]);
  const t = await getTranslations();
  const isBool = (key: SettingKey) => SETTING_SCHEMAS[key].safeParse(true).success;

  return (
    <>
      <h1>{t('admin.title')}</h1>

      <section className="card">
        <h2>{t('admin.settings')}</h2>
        <p className="muted small">{t('admin.settingsHint')}</p>
        <ul className="list">
          {(Object.keys(SETTING_SCHEMAS) as SettingKey[]).map((key) => (
            <li key={key}>
              <ActionForm action={updateSettingAction} className="row">
                <input type="hidden" name="key" value={key} />
                {isBool(key) ? (
                  <Checkbox
                    name="value"
                    label={t(`admin.keys.${key}`)}
                    defaultChecked={settings[key] === true}
                  />
                ) : (
                  <Field
                    name="value"
                    type="number"
                    label={t(`admin.keys.${key}`)}
                    defaultValue={settings[key] === null ? '' : String(settings[key])}
                    placeholder={
                      SETTING_SCHEMAS[key].safeParse(null).success
                        ? t('admin.nullMeansOff')
                        : undefined
                    }
                  />
                )}
                <SubmitButton variant="secondary">{t('common.save')}</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>{t('admin.users')}</h2>
        <form className="row" action="/admin">
          <input
            name="q"
            defaultValue={q}
            placeholder={t('admin.search')}
            style={{ maxInlineSize: 320 }}
          />
          <button type="submit" className="btn btn-secondary">
            {t('admin.search')}
          </button>
        </form>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('auth.fullName')}</th>
                <th>{t('auth.email')}</th>
                <th>{t('admin.role')}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>{u.fullName}</td>
                  <td className="ltr">{u.email}</td>
                  <td>
                    {u.platformRole === 'admin' ? t('admin.adminRole') : t('admin.userRole')} ·{' '}
                    {u.status === 'active' ? t('admin.statusActive') : t('admin.statusDisabled')}
                  </td>
                  <td>
                    {u.id !== principal.user.id && (
                      <ActionForm action={toggleUserAction} className="row">
                        <input type="hidden" name="userId" value={u.id} />
                        <input
                          type="hidden"
                          name="op"
                          value={u.status === 'active' ? 'disable' : 'enable'}
                        />
                        <input
                          name="reason"
                          placeholder={t('admin.reason')}
                          required
                          maxLength={500}
                        />
                        <SubmitButton variant={u.status === 'active' ? 'danger' : 'secondary'}>
                          {u.status === 'active' ? t('admin.disable') : t('admin.enable')}
                        </SubmitButton>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>{t('admin.events')}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td>
                    {e.name}
                    <br />
                    <span className="muted small">
                      {formatShortDateTime(e.startsAt, e.timezone)} ·{' '}
                      <span className="ltr">{e.ownerEmail}</span>
                    </span>
                  </td>
                  <td>
                    <StatusBadge status={e.status} disabled={e.disabledAt !== null} />
                  </td>
                  <td>
                    <ActionForm action={toggleEventAction} className="row">
                      <input type="hidden" name="eventId" value={e.id} />
                      <input type="hidden" name="op" value={e.disabledAt ? 'enable' : 'disable'} />
                      <input
                        name="reason"
                        placeholder={t('admin.reason')}
                        required
                        maxLength={500}
                      />
                      <SubmitButton variant={e.disabledAt ? 'secondary' : 'danger'}>
                        {e.disabledAt ? t('admin.enable') : t('admin.disable')}
                      </SubmitButton>
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {events.length === 0 && <p className="muted">{t('admin.empty')}</p>}
        </div>
      </section>

      <section className="card">
        <h2>{t('admin.audit')}</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td className="ltr small">
                    {a.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </td>
                  <td className="ltr small">{a.action}</td>
                  <td className="ltr small">
                    {a.targetType}:{a.targetId}
                  </td>
                  <td className="small">{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {audit.length === 0 && <p className="muted">{t('admin.empty')}</p>}
        </div>
      </section>
    </>
  );
}
