import {
  formatPhone,
  getImportBatch,
  guestsEditable,
  isDomainError,
  listImportRows,
  ROW_FILTERS,
  type RowFilter,
  type RowIssue,
} from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { ActionForm } from '@/components/forms';
import { CommitBar } from '@/components/guests/commit-bar';
import { ImportSteps } from '@/components/guests/import-steps';
import { Icon } from '@/components/icons';
import { loadEventView } from '@/lib/events';
import { formatBytes, formatCount } from '@/lib/format';
import { UUID } from '@/lib/guests';
import { getCoreContext } from '@/lib/server';
import { commitImportAction, discardImportAction, importDecisionAction } from '../../actions';

export const metadata: Metadata = { title: 'مراجعة الاستيراد' };

type T = Awaited<ReturnType<typeof getTranslations>>;

/** Step 2 and 3 of an import: review every row and decide, then the result. */
export default async function ImportBatchPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; batchId: string }>;
  searchParams: Promise<{ filter?: string; page?: string }>;
}) {
  const { id, batchId } = await params;
  if (!UUID.test(batchId)) notFound();
  const sp = await searchParams;
  const { principal, view } = await loadEventView(id);
  if (view.membership.role !== 'owner') notFound();
  const ctx = getCoreContext();
  const userId = principal.user.id;
  const t = await getTranslations();
  const base = `/events/${id}/guests`;
  const here = `${base}/import/${batchId}`;

  let batch;
  try {
    batch = await getImportBatch(ctx, userId, id, batchId);
  } catch (err) {
    if (isDomainError(err)) notFound();
    throw err;
  }
  const editable = guestsEditable(view.event) && !view.event.disabledAt;

  const head = (step: 'upload' | 'review' | 'done') => (
    <>
      <div className="page-head">
        <div className="titles">
          <Link href={base} className="back-link">
            <Icon name="chevronBack" />
            {t('guests.import.back')}
          </Link>
          <h2 className="t-title">{t('guests.import.title')}</h2>
          <p className="t-support" dir="auto">
            {t('guests.import.review.file', {
              name: batch.originalFilename,
              size: formatBytes(batch.fileSize),
            })}
          </p>
        </div>
      </div>
      <ImportSteps current={step} />
    </>
  );

  if (batch.status === 'failed') {
    const detail = (batch.errorDetail ?? {}) as { missing?: string[]; found?: string[] };
    const code = batch.errorCode ?? 'file_unreadable';
    return (
      <div className="stack-lg import-page">
        {head('upload')}
        <section className="panel result result-failed" aria-labelledby="fail-h">
          <span className="glyph">
            <Icon name="alert" />
          </span>
          <h3 id="fail-h">{t('guests.import.failed.title')}</h3>
          <p>
            {code === 'missing_headers' && detail.missing
              ? t('guests.import.failed.missingHeaders', {
                  columns: detail.missing.map((f) => `«${fieldHeader(t, f)}»`).join(' و'),
                })
              : t.has(`guests.import.failed.codes.${code}`)
                ? t(`guests.import.failed.codes.${code}`)
                : t('guests.import.failed.codes.file_unreadable')}
          </p>
          {detail.found && detail.found.length > 0 && (
            <p className="muted">
              {t('guests.import.failed.found', { names: detail.found.join('، ') })}
            </p>
          )}
          <div className="row-tight">
            <Link href={`${base}/import`} className={buttonClass('primary')}>
              <Icon name="upload" />
              {t('guests.import.failed.tryAgain')}
            </Link>
            <a href={`${base}/import/template`} className={buttonClass('secondary')} download>
              <Icon name="download" />
              {t('guests.template')}
            </a>
          </div>
        </section>
      </div>
    );
  }

  if (batch.status === 'committed') {
    return (
      <div className="stack-lg import-page">
        {head('done')}
        <section className="panel result result-ok" aria-labelledby="done-h">
          <span className="glyph">
            <Icon name="checkCircle" />
          </span>
          <h3 id="done-h">{t('guests.import.done.title')}</h3>
          <p>
            {t('guests.import.done.body', {
              imported: t('guests.count', { count: batch.importedCount ?? 0 }),
              skipped: t('guests.count', { count: batch.skippedCount ?? 0 }),
            })}
          </p>
          <div className="row-tight">
            <Link href={`${base}?source=excel_import`} className={buttonClass('primary')}>
              {t('guests.import.done.view')}
              <Icon name="arrow" />
            </Link>
            {(batch.skippedCount ?? 0) > 0 && (
              <a href={`${here}/report`} className={buttonClass('secondary')} download>
                <Icon name="download" />
                {t('guests.import.review.report')}
              </a>
            )}
            <Link href={`${base}/import`} className={buttonClass('ghost')}>
              {t('guests.import.done.another')}
            </Link>
          </div>
        </section>
      </div>
    );
  }

  if (
    batch.status === 'discarded' ||
    batch.status === 'uploaded' ||
    batch.status === 'committing'
  ) {
    const discarded = batch.status === 'discarded';
    return (
      <div className="stack-lg import-page">
        {head('upload')}
        <section className="panel result">
          <h3>
            {discarded
              ? t('guests.import.discarded.title')
              : t('guests.import.state.' + batch.status)}
          </h3>
          <p>{discarded ? t('guests.import.discarded.body') : t('guests.import.committingNow')}</p>
          <Link href={discarded ? `${base}/import` : here} className={buttonClass('secondary')}>
            {discarded ? t('guests.import.done.another') : t('guests.import.open')}
          </Link>
        </section>
      </div>
    );
  }

  // Review
  const filter: RowFilter = (ROW_FILTERS as readonly string[]).includes(sp.filter ?? '')
    ? (sp.filter as RowFilter)
    : batch.reviewCount > 0
      ? 'needs_review'
      : 'all';
  const page = Math.max(1, Number(sp.page) || 1);
  const rows = await listImportRows(ctx, userId, id, batchId, { filter, page, pageSize: 50 });
  const ignored = ((batch.errorDetail ?? {}) as { ignoredColumns?: string[] }).ignoredColumns ?? [];
  const counts: Record<RowFilter, number> = {
    all: batch.rowCount,
    needs_review: batch.reviewCount,
    invalid: batch.invalidCount,
    ready: batch.readyCount,
    undecided: batch.undecided,
    skipped: batch.toSkip,
  };
  const decide = importDecisionAction.bind(null, id, batchId);
  const href = (f: RowFilter, p = 1) => `${here}?filter=${f}${p > 1 ? `&page=${p}` : ''}`;

  return (
    <div className="stack-lg import-page">
      {head('review')}

      <section className="import-summary" aria-label={t('guests.import.review.title')}>
        <p className="found">
          {t('guests.import.review.rowsFound', { count: formatCount(batch.rowCount) })}
        </p>
        <dl className="import-counts">
          <div className="is-ready">
            <dt>{t('guests.import.review.ready')}</dt>
            <dd>{formatCount(batch.readyCount)}</dd>
          </div>
          <div className="is-review">
            <dt>{t('guests.import.review.needsReview')}</dt>
            <dd>{formatCount(batch.reviewCount)}</dd>
          </div>
          <div className="is-invalid">
            <dt>{t('guests.import.review.invalid')}</dt>
            <dd>{formatCount(batch.invalidCount)}</dd>
          </div>
        </dl>
        <p className="plan">
          {t('guests.import.review.plan', {
            import: formatCount(batch.toImport),
            skip: formatCount(batch.toSkip),
          })}
          {batch.newGroups > 0 &&
            ` · ${t('guests.import.review.newGroups', { count: batch.newGroups })}`}
        </p>
        {ignored.length > 0 && (
          <p className="muted small">
            {t('guests.import.review.ignoredColumns', { names: ignored.join('، ') })}
          </p>
        )}
      </section>

      <p className="muted small mobile-only">{t('guests.import.review.desktopNote')}</p>

      <nav className="segmented import-filters" aria-label={t('guests.filters.title')}>
        {ROW_FILTERS.map((f) => (
          <Link
            key={f}
            href={href(f)}
            aria-current={filter === f ? 'page' : undefined}
            scroll={false}
          >
            {t(`guests.import.review.filters.${f}`)}
            <span className="count">{formatCount(counts[f])}</span>
          </Link>
        ))}
      </nav>

      {editable && (
        <ActionForm action={decide} className="import-rows-form">
          {batch.undecided > 0 && (
            <div className="alert alert-warn undecided-bar">
              <Icon name="alert" />
              <span className="grow">
                {t('guests.import.review.undecided', { count: batch.undecided })}
              </span>
              <span className="row-tight">
                <button
                  type="submit"
                  name="decide"
                  value="add_anyway:undecided"
                  className={buttonClass('secondary', 'sm')}
                >
                  {t('guests.import.review.addAllAnyway')}
                </button>
                <button
                  type="submit"
                  name="decide"
                  value="skip:undecided"
                  className={buttonClass('secondary', 'sm')}
                >
                  {t('guests.import.review.skipAll')}
                </button>
              </span>
            </div>
          )}
          <RowsTable
            rows={rows.rows}
            t={t}
            editable
            defaultCompanions={view.event.defaultAllowedCompanions}
          />
        </ActionForm>
      )}
      {!editable && (
        <RowsTable
          rows={rows.rows}
          t={t}
          editable={false}
          defaultCompanions={view.event.defaultAllowedCompanions}
        />
      )}

      {rows.pages > 1 && (
        <nav className="pager" aria-label={t('guests.pager.label')}>
          <span className="range">
            {t('guests.pager.range', {
              from: formatCount((rows.page - 1) * 50 + 1),
              to: formatCount(Math.min(rows.total, rows.page * 50)),
              total: formatCount(rows.total),
            })}
          </span>
          <span className="row-tight">
            {rows.page > 1 && (
              <Link href={href(filter, rows.page - 1)} className={buttonClass('secondary', 'sm')}>
                {t('guests.pager.prev')}
              </Link>
            )}
            {rows.page < rows.pages && (
              <Link href={href(filter, rows.page + 1)} className={buttonClass('secondary', 'sm')}>
                {t('guests.pager.next')}
              </Link>
            )}
          </span>
        </nav>
      )}

      {editable && (
        <div className="commit-bar">
          <CommitBar
            action={commitImportAction.bind(null, id, batchId)}
            count={batch.toImport}
            blocked={batch.undecided > 0}
          />
          <span className="grow" />
          {batch.toSkip > 0 && (
            <a href={`${here}/report`} className={buttonClass('ghost', 'sm')} download>
              <Icon name="download" />
              {t('guests.import.review.report')}
            </a>
          )}
          <ActionForm action={discardImportAction.bind(null, id, batchId)} className="inline-form">
            <ConfirmSubmit
              name="op"
              value="discard"
              variant="danger"
              size="sm"
              confirm={t('guests.import.review.discardConfirm')}
            >
              {t('guests.import.review.discard')}
            </ConfirmSubmit>
          </ActionForm>
        </div>
      )}
    </div>
  );
}

function fieldHeader(t: T, field: string) {
  const headers: Record<string, string> = { fullName: 'الاسم', phone: 'رقم الجوال' };
  return headers[field] ?? t('guests.import.columnsTitle');
}

type Row = Awaited<ReturnType<typeof listImportRows>>['rows'][number];

function issueText(t: T, issue: RowIssue, row: Row): string {
  const names = row.matches
    .filter((m) => issue.guestIds?.includes(m.id))
    .map((m) => `${m.fullName}${m.groupName ? ` (${m.groupName})` : ''}`)
    .join('، ');
  const key = `guests.import.issues.${issue.code}`;
  return t.has(key) ? t(key, { names, row: String(issue.row ?? '') }) : issue.code;
}

function RowsTable({
  rows,
  t,
  editable,
  defaultCompanions,
}: {
  rows: Row[];
  t: T;
  editable: boolean;
  defaultCompanions: number;
}) {
  if (rows.length === 0) return <p className="panel muted">{t('guests.import.review.empty')}</p>;
  return (
    <div className="table-wrap">
      <table className="import-table">
        <thead>
          <tr>
            <th className="c-row">{t('guests.import.review.columns.row')}</th>
            <th>{t('guests.import.review.columns.guest')}</th>
            <th>{t('guests.import.review.columns.phone')}</th>
            <th>{t('guests.import.review.columns.group')}</th>
            <th>{t('guests.import.review.columns.companions')}</th>
            <th className="c-check-result">{t('guests.import.review.columns.check')}</th>
            <th className="c-decision">{t('guests.import.review.columns.decision')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const raw = r.raw as Record<string, string | undefined>;
            const problems = r.issues.filter((i) => i.severity !== 'info');
            const notes = r.issues.filter(
              (i) => i.severity === 'info' && i.code !== 'companions_default',
            );
            const options =
              r.validation === 'invalid'
                ? []
                : r.validation === 'ready'
                  ? (['import', 'skip'] as const)
                  : (['add_anyway', 'skip'] as const);
            return (
              <tr key={r.id} data-state={r.validation}>
                <td className="c-row num">{r.rowNumber}</td>
                <td className="c-guest">
                  {r.fullName ?? <span className="muted">{raw.fullName || '—'}</span>}
                </td>
                <td className="c-phone">
                  {r.phoneE164 ? (
                    <>
                      <span dir="ltr" className="num">
                        {formatPhone(r.phoneE164)}
                      </span>
                      {raw.phone && raw.phone.replace(/\s/g, '') !== r.phoneE164 && (
                        <span className="note" dir="ltr">
                          {raw.phone}
                        </span>
                      )}
                    </>
                  ) : (
                    <span dir="ltr" className="muted">
                      {raw.phone || '—'}
                    </span>
                  )}
                </td>
                <td className="c-group">
                  {r.groupName ?? <span className="muted">—</span>}
                  {r.issues.some((i) => i.code === 'new_group') && (
                    <span className="tag tag-accent">{t('guests.import.review.newGroup')}</span>
                  )}
                </td>
                <td className="c-comp num">
                  {r.allowedCompanions ??
                    (r.validation === 'invalid'
                      ? raw.companions || '—'
                      : t('guests.import.review.default', { n: defaultCompanions }))}
                </td>
                <td className="c-check-result">
                  <span className={`vstate vstate-${r.validation}`}>
                    {r.validation === 'ready'
                      ? t('guests.import.review.ready')
                      : r.validation === 'needs_review'
                        ? t('guests.import.review.needsReview')
                        : t('guests.import.review.invalid')}
                  </span>
                  {[...problems, ...notes].length > 0 && (
                    <ul className="issues">
                      {[...problems, ...notes].map((i, n) => (
                        <li key={n} data-severity={i.severity}>
                          {issueText(t, i, r)}
                        </li>
                      ))}
                    </ul>
                  )}
                </td>
                <td className="c-decision">
                  {options.length === 0 || !editable ? (
                    <span className={`decision decision-${r.decision ?? 'none'}`}>
                      {t(`guests.import.review.decision.${r.decision ?? 'none'}`)}
                    </span>
                  ) : (
                    <span
                      className="decide"
                      role="group"
                      aria-label={`${t('guests.import.review.columns.decision')} ${r.rowNumber}`}
                    >
                      {options.map((o) => (
                        <button
                          key={o}
                          type="submit"
                          name="decide"
                          value={`${o}:row:${r.id}`}
                          aria-pressed={r.decision === o}
                          className={`choice${r.decision === o ? ' is-on' : ''}`}
                        >
                          {t(`guests.import.review.decision.${o}`)}
                        </button>
                      ))}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
