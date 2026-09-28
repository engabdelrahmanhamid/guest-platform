import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { ReactNode } from 'react';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { buttonClass } from '@/components/button';
import { ActionForm } from '@/components/forms';
import { EVENT_TYPE_ICONS, Icon } from '@/components/icons';
import { Menu } from '@/components/menu';
import { StatusBadge } from '@/components/status-badge';
import { WorkspaceNav } from '@/components/workspace-nav';
import { ACTION_ICON, groupActions, loadEventView, WORKSPACE_AREAS } from '@/lib/events';
import { formatDayMonth, formatTime } from '@/lib/format';
import { transitionAction } from '../../actions';

/**
 * The event workspace: a persistent header (identity, status, the one next action) and the
 * event's areas. Every area page renders below it.
 */
export default async function EventWorkspaceLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: ReactNode;
}) {
  const { id } = await params;
  const { view } = await loadEventView(id);
  const { event: e } = view;
  const t = await getTranslations();
  const isOwner = view.membership.role === 'owner';
  const { primary, secondary, canCancel } = groupActions(view.allowedActions);
  const base = `/events/${id}`;
  const tz = e.timezone;

  return (
    <div className="workspace">
      <header className="ws-head">
        <nav className="crumbs" aria-label={t('workspace.crumbsLabel')}>
          <Link href="/events">{t('nav.events')}</Link>
          <Icon name="chevronOn" />
          <span aria-current="page">{e.name}</span>
        </nav>
        <div className="ws-top">
          <div className="ws-title">
            <div className="name-row">
              <h1>{e.name}</h1>
              <StatusBadge status={e.status} disabled={e.disabledAt !== null} size="lg" />
            </div>
            <p className="ws-meta">
              <span>
                <Icon name={EVENT_TYPE_ICONS[e.type] ?? 'sparkle'} />
                {t(`eventType.${e.type}`)}
              </span>
              <span>
                <Icon name="calendar" />
                {formatDayMonth(e.startsAt, tz)} · {formatTime(e.startsAt, tz)}
              </span>
              <span>
                <Icon name="pin" />
                {e.city} · {e.venueName}
              </span>
            </p>
          </div>

          {isOwner && (
            <ActionForm action={transitionAction.bind(null, id)} className="ws-actions">
              <input type="hidden" name="expectedStatus" value={e.status} />
              {primary && (
                <ConfirmSubmit
                  name="action"
                  value={primary}
                  confirm={t(`overview.confirm.${primary}`)}
                  className={`${buttonClass('primary')} ws-primary`}
                >
                  <Icon name={ACTION_ICON[primary]} />
                  {t(`overview.actions.${primary}`)}
                </ConfirmSubmit>
              )}
              {/* Without a forward step, the remaining transitions (reopen, archive) show as
                  secondary buttons rather than promoting an irreversible one to primary. */}
              {!primary &&
                secondary.map((a) => (
                  <ConfirmSubmit
                    key={a}
                    name="action"
                    value={a}
                    confirm={t(`overview.confirm.${a}`)}
                    variant="secondary"
                  >
                    <Icon name={ACTION_ICON[a]} />
                    {t(`overview.actions.${a}`)}
                  </ConfirmSubmit>
                ))}
              <Menu
                label={t('workspace.more')}
                summary={<Icon name="dotsV" />}
                summaryClassName="icon-btn"
              >
                <Link href={`${base}/settings`} className="menu-item">
                  <Icon name={view.canEdit ? 'edit' : 'settings'} />
                  {view.canEdit ? t('workspace.editDetails') : t('workspace.areas.settings')}
                </Link>
                <span className="menu-item" aria-disabled="true">
                  <Icon name="eye" />
                  <span className="grow">{t('workspace.preview')}</span>
                  <span className="tag">{t('workspace.soon')}</span>
                </span>
                {canCancel && (
                  <>
                    <hr className="menu-sep" />
                    <Link href={`${base}/cancel`} className="menu-item danger">
                      <Icon name="ban" />
                      {t('overview.actions.cancel')}
                    </Link>
                  </>
                )}
              </Menu>
            </ActionForm>
          )}
        </div>
        <WorkspaceNav
          label={t('workspace.navLabel')}
          soonLabel={t('workspace.soon')}
          items={WORKSPACE_AREAS.map((a) => ({
            href: `${base}${a.path}`,
            label: t(`workspace.areas.${a.key}`),
            icon: a.icon,
            ready: a.ready,
            ...(a.key === 'settings' ? { also: [`${base}/cancel`] } : {}),
          }))}
        />
      </header>

      {e.disabledAt && (
        <p className="alert alert-error">
          <Icon name="ban" />
          <span className="grow">
            <strong>{t('workspace.disabledTitle')}</strong>{' '}
            {t('overview.disabledNotice', { reason: e.disabledReason ?? '' })}
          </span>
        </p>
      )}
      {e.cancelledAt && (
        <p className="alert alert-neutral">
          <Icon name="ban" />
          <span className="grow">
            <strong>{t('workspace.cancelledTitle')}</strong>{' '}
            {t('workspace.cancelledBody', { reason: e.cancellationReason ?? '' })}
          </span>
        </p>
      )}

      {children}
    </div>
  );
}
