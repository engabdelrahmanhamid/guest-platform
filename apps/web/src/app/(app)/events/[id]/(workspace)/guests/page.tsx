import {
  formatPhone,
  GUEST_SORTS,
  guestSummary,
  guestsEditable,
  isDomainError,
  listGroups,
  listGuests,
  PAGE_SIZES,
} from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { AutoSubmit } from '@/components/guests/auto-submit';
import { BulkForm } from '@/components/guests/bulk';
import { Icon } from '@/components/icons';
import { Menu } from '@/components/menu';
import { loadEventView } from '@/lib/events';
import { formatCount, formatShortDate } from '@/lib/format';
import { guestsHref, pickParams, UUID } from '@/lib/guests';
import { getCoreContext } from '@/lib/server';
import { bulkAction } from './actions';
import { GuestPanels } from './panels';

export const metadata: Metadata = { title: 'الضيوف' };

type SP = Promise<Record<string, string | string[] | undefined>>;

/**
 * The guest list: summary, search and filters, the list itself (a table on wide screens,
 * cards on phones) and a drawer for one guest, adding, editing or groups, opened by the URL.
 */
export default async function GuestsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SP;
}) {
  const { id } = await params;
  const sp = pickParams(await searchParams);
  const { principal, view } = await loadEventView(id);
  const e = view.event;
  if (view.membership.role !== 'owner') notFound();
  const ctx = getCoreContext();
  const userId = principal.user.id;
  const t = await getTranslations();
  const base = `/events/${id}/guests`;

  let data;
  try {
    data = await Promise.all([
      listGuests(ctx, userId, id, sp),
      guestSummary(ctx, userId, id),
      listGroups(ctx, userId, id),
    ]);
  } catch (err) {
    if (isDomainError(err, 'forbidden') || isDomainError(err, 'not_found')) notFound();
    throw err;
  }
  const [list, summary, groups] = data;
  const editable = guestsEditable(e) && !e.disabledAt;
  const here = guestsHref(base, sp);
  const tz = e.timezone;

  const q = sp.q?.trim() ?? '';
  const status = sp.status === 'active' || sp.status === 'cancelled' ? sp.status : 'all';
  const source = sp.source === 'manual' || sp.source === 'excel_import' ? sp.source : 'all';
  const group = sp.group === 'none' || (sp.group && UUID.test(sp.group)) ? sp.group : 'all';
  const sort = (GUEST_SORTS as readonly string[]).includes(sp.sort ?? '') ? sp.sort! : 'recent';
  const groupName = (gid: string) => groups.find((g) => g.id === gid)?.name ?? '';
  const chips: { label: string; key: 'q' | 'status' | 'group' | 'source' }[] = [
    ...(q ? [{ label: `«${q}»`, key: 'q' as const }] : []),
    ...(status !== 'all' ? [{ label: t(`guests.status.${status}`), key: 'status' as const }] : []),
    ...(group !== 'all'
      ? [
          {
            label: group === 'none' ? t('guests.noGroup') : groupName(group),
            key: 'group' as const,
          },
        ]
      : []),
    ...(source !== 'all' ? [{ label: t(`guests.source.${source}`), key: 'source' as const }] : []),
  ];
  const filtered = chips.length > 0;
  const activeFilters = chips.filter((c) => c.key !== 'q').length;
  const from = list.total === 0 ? 0 : (list.page - 1) * list.pageSize + 1;
  const to = Math.min(list.total, list.page * list.pageSize);

  return (
    <div className="stack-lg guests-page">
      <div className="page-head">
        <div className="titles">
          <h2 className="t-title">{t('guests.title')}</h2>
          <p className="t-support">{t('guests.subtitle')}</p>
        </div>
        {editable && summary.total > 0 && (
          <div className="row-tight head-actions">
            <Link href={`${base}/import`} className={buttonClass('secondary')}>
              <Icon name="upload" />
              {t('guests.importAction')}
            </Link>
            <Link
              href={guestsHref(base, sp, { panel: 'add', guest: null })}
              scroll={false}
              className={buttonClass('primary')}
            >
              <Icon name="plus" />
              {t('guests.add')}
            </Link>
            <Menu
              label={t('guests.more')}
              summary={<Icon name="dotsV" />}
              summaryClassName="icon-btn"
            >
              <Link
                href={guestsHref(base, sp, { panel: 'groups', guest: null })}
                scroll={false}
                className="menu-item"
              >
                <Icon name="tag" />
                {t('guests.manageGroups')}
              </Link>
              <a href={`${base}/import/template`} className="menu-item" download>
                <Icon name="download" />
                {t('guests.template')}
              </a>
            </Menu>
          </div>
        )}
      </div>

      {sp.done && t.has(`guests.done.${sp.done}`) && (
        <p role="status" className="alert alert-ok">
          <Icon name="checkCircle" />
          <span className="grow">{t(`guests.done.${sp.done}`)}</span>
        </p>
      )}
      {!editable && (
        <p className="alert alert-neutral">
          <Icon name="info" />
          <span className="grow">{t('guests.readOnly', { status: t(`status.${e.status}`) })}</span>
        </p>
      )}

      {summary.total === 0 ? (
        <div className="panel">
          <EmptyState
            icon="users"
            title={t('guests.empty.title')}
            body={editable ? t('guests.empty.body') : t('guests.empty.readOnly')}
            action={
              editable && (
                <>
                  <Link
                    href={guestsHref(base, sp, { panel: 'add' })}
                    scroll={false}
                    className={buttonClass('primary')}
                  >
                    <Icon name="plus" />
                    {t('guests.add')}
                  </Link>
                  <Link href={`${base}/import`} className={buttonClass('secondary')}>
                    <Icon name="upload" />
                    {t('guests.importAction')}
                  </Link>
                </>
              )
            }
          />
        </div>
      ) : (
        <>
          <dl className="guest-stats" aria-label={t('guests.summary.label')}>
            <div>
              <dt>{t('guests.summary.total')}</dt>
              <dd>{formatCount(summary.total)}</dd>
            </div>
            <div>
              <dt>{t('guests.summary.active')}</dt>
              <dd>{formatCount(summary.active)}</dd>
            </div>
            <div>
              <dt>{t('guests.summary.cancelled')}</dt>
              <dd>{formatCount(summary.cancelled)}</dd>
            </div>
            <div className="is-capacity">
              <dt>{t('guests.summary.capacity')}</dt>
              <dd>{formatCount(summary.potentialCapacity)}</dd>
              <p>{t('guests.summary.capacityHint')}</p>
            </div>
          </dl>

          <section className="guest-list" aria-labelledby="list-h">
            <h3 id="list-h" className="sr-only">
              {t('guests.title')}
            </h3>
            <form className="guest-toolbar" action={base} role="search">
              {sp.pageSize && <input type="hidden" name="pageSize" value={sp.pageSize} />}
              <div className="search-box">
                <Icon name="search" />
                <label htmlFor="q" className="sr-only">
                  {t('guests.search.label')}
                </label>
                <input
                  id="q"
                  name="q"
                  type="search"
                  defaultValue={q}
                  placeholder={t('guests.search.placeholder')}
                  autoComplete="off"
                  maxLength={100}
                />
              </div>
              <div
                className="status-seg segmented"
                role="group"
                aria-label={t('guests.filters.status')}
              >
                {(['all', 'active', 'cancelled'] as const).map((s) => (
                  <Link
                    key={s}
                    href={guestsHref(base, sp, { status: s, page: null, guest: null, panel: null })}
                    aria-current={status === s ? 'page' : undefined}
                    scroll={false}
                  >
                    {s === 'all' ? t('guests.filters.all') : t(`guests.status.${s}`)}
                    <span className="count">
                      {formatCount(
                        s === 'all'
                          ? summary.total
                          : s === 'active'
                            ? summary.active
                            : summary.cancelled,
                      )}
                    </span>
                  </Link>
                ))}
              </div>
              <details className="filter-sheet">
                <summary className={buttonClass('secondary')}>
                  <Icon name="filter" />
                  {t('guests.filters.open')}
                  {activeFilters > 0 && <span className="count-dot">{activeFilters}</span>}
                </summary>
                <div className="filter-body">
                  <input type="hidden" name="status" value={status} />
                  <label className="mini-field">
                    <span>{t('guests.filters.group')}</span>
                    <select name="group" defaultValue={group}>
                      <option value="all">{t('guests.filters.allGroups')}</option>
                      <option value="none">{t('guests.noGroup')}</option>
                      {groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mini-field">
                    <span>{t('guests.filters.source')}</span>
                    <select name="source" defaultValue={source}>
                      <option value="all">{t('guests.filters.allSources')}</option>
                      <option value="manual">{t('guests.source.manual')}</option>
                      <option value="excel_import">{t('guests.source.excel_import')}</option>
                    </select>
                  </label>
                  <label className="mini-field">
                    <span>{t('guests.filters.sort')}</span>
                    <select name="sort" defaultValue={sort}>
                      {GUEST_SORTS.map((s) => (
                        <option key={s} value={s}>
                          {t(`guests.filters.sorts.${s}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={buttonClass('primary', 'sm')}>
                    {t('guests.filters.apply')}
                  </button>
                </div>
              </details>
              <AutoSubmit />
            </form>

            {filtered && (
              <div className="chips" aria-label={t('guests.filters.title')}>
                {chips.map((c) => (
                  <Link
                    key={c.key}
                    href={guestsHref(base, sp, {
                      [c.key]: null,
                      page: null,
                      guest: null,
                      panel: null,
                    })}
                    className="chip"
                    scroll={false}
                    aria-label={t('guests.filters.remove', { label: c.label })}
                  >
                    {c.label}
                    <Icon name="x" />
                  </Link>
                ))}
                <Link
                  href={guestsHref(base, { pageSize: sp.pageSize, sort: sp.sort })}
                  className={buttonClass('link', 'sm')}
                >
                  {t('guests.filters.clear')}
                </Link>
              </div>
            )}

            {list.total === 0 ? (
              <div className="panel">
                <EmptyState
                  icon="search"
                  title={t('guests.noResults.title')}
                  body={t('guests.noResults.body')}
                  headingLevel={3}
                  action={
                    <Link
                      href={guestsHref(base, { pageSize: sp.pageSize })}
                      className={buttonClass('secondary')}
                    >
                      {t('guests.filters.clear')}
                    </Link>
                  }
                />
              </div>
            ) : (
              <BulkForm action={bulkAction.bind(null, id)} returnTo={here} groups={groups}>
                <div className="table-wrap guest-table-wrap">
                  <table className="guest-table">
                    <thead>
                      <tr>
                        {editable && (
                          <th className="c-check">
                            <input
                              type="checkbox"
                              data-select-all
                              aria-label={t('guests.columns.selectAll')}
                            />
                          </th>
                        )}
                        <th className="c-name">{t('guests.columns.guest')}</th>
                        <th className="c-phone">{t('guests.columns.phone')}</th>
                        <th className="c-group">{t('guests.columns.group')}</th>
                        <th className="c-comp">{t('guests.columns.companions')}</th>
                        <th className="c-source">{t('guests.columns.source')}</th>
                        <th className="c-status">{t('guests.columns.status')}</th>
                        <th className="c-added">{t('guests.columns.added')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.rows.map((g) => (
                        <tr
                          key={g.id}
                          data-status={g.status}
                          aria-current={sp.guest === g.id ? 'true' : undefined}
                        >
                          {editable && (
                            <td className="c-check">
                              <input
                                type="checkbox"
                                name="ids"
                                value={g.id}
                                aria-label={`${t('guests.columns.select')} ${g.fullName}`}
                              />
                            </td>
                          )}
                          <td className="c-name">
                            <Link
                              href={guestsHref(base, sp, { guest: g.id, panel: null })}
                              scroll={false}
                              className="row-link"
                            >
                              <span className="avatar" aria-hidden="true">
                                {g.fullName.trim().charAt(0)}
                              </span>
                              <span className="nm">{g.fullName}</span>
                            </Link>
                          </td>
                          <td className="c-phone">
                            <span dir="ltr" className="num">
                              {formatPhone(g.phoneE164)}
                            </span>
                          </td>
                          <td className="c-group">
                            {g.groupName ?? <span className="muted">—</span>}
                          </td>
                          <td className="c-comp">
                            <span
                              className="comp"
                              title={t('guests.companionsLabel', { count: g.allowedCompanions })}
                            >
                              {t('guests.companionsShort', { count: g.allowedCompanions })}
                            </span>
                          </td>
                          <td className="c-source">
                            <span className="src">
                              <Icon name={g.source === 'excel_import' ? 'file' : 'edit'} />
                              {t(`guests.source.${g.source}`)}
                            </span>
                          </td>
                          <td className="c-status">
                            <span className={`gstatus gstatus-${g.status}`}>
                              {t(`guests.status.${g.status}`)}
                            </span>
                          </td>
                          <td className="c-added">{formatShortDate(g.createdAt, tz)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </BulkForm>
            )}

            {list.total > 0 && (
              <nav className="pager" aria-label={t('guests.pager.label')}>
                <span className="range">
                  {t('guests.pager.range', {
                    from: formatCount(from),
                    to: formatCount(to),
                    total: formatCount(list.total),
                  })}
                </span>
                <span className="row-tight">
                  {list.page > 1 ? (
                    <Link
                      href={guestsHref(base, sp, { page: String(list.page - 1), guest: null })}
                      className={buttonClass('secondary', 'sm')}
                    >
                      <Icon name="chevronBack" />
                      {t('guests.pager.prev')}
                    </Link>
                  ) : null}
                  {list.page < list.pages ? (
                    <Link
                      href={guestsHref(base, sp, { page: String(list.page + 1), guest: null })}
                      className={buttonClass('secondary', 'sm')}
                    >
                      {t('guests.pager.next')}
                      <Icon name="chevronOn" />
                    </Link>
                  ) : null}
                </span>
                <span className="per-page">
                  {t('guests.pager.perPage')}
                  {PAGE_SIZES.map((n) => (
                    <Link
                      key={n}
                      href={guestsHref(base, sp, { pageSize: String(n), page: null })}
                      aria-current={list.pageSize === n ? 'page' : undefined}
                    >
                      {n}
                    </Link>
                  ))}
                </span>
              </nav>
            )}
          </section>
        </>
      )}

      <GuestPanels eventId={id} params={sp} groups={groups} editable={editable} event={e} />
    </div>
  );
}
