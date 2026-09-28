import {
  guestsEditable,
  HEADER_ALIASES,
  IMPORT_FIELDS,
  listImportBatches,
  REQUIRED_FIELDS,
  TEMPLATE_HEADERS,
} from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/button';
import { UploadForm } from '@/components/guests/upload-form';
import { ImportSteps } from '@/components/guests/import-steps';
import { Icon } from '@/components/icons';
import { loadEventView } from '@/lib/events';
import { formatCount, formatShortDateTime } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { uploadImportAction } from '../actions';

export const metadata: Metadata = { title: 'استيراد الضيوف' };

/** Step 1 of an import: the template, what the file must contain, and the upload. */
export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { principal, view } = await loadEventView(id);
  if (view.membership.role !== 'owner') notFound();
  const e = view.event;
  const base = `/events/${id}/guests`;
  if (!guestsEditable(e) || e.disabledAt) redirect(base);
  const t = await getTranslations();
  const recent = await listImportBatches(getCoreContext(), principal.user.id, id, 5);

  return (
    <div className="stack-lg import-page">
      <div className="page-head">
        <div className="titles">
          <Link href={base} className="back-link">
            <Icon name="chevronBack" />
            {t('guests.import.back')}
          </Link>
          <h2 className="t-title">{t('guests.import.title')}</h2>
          <p className="t-support">{t('guests.import.intro')}</p>
        </div>
      </div>
      <ImportSteps current="upload" />

      <div className="import-grid">
        <section className="panel stack" aria-labelledby="upload-h">
          <h3 id="upload-h" className="sr-only">
            {t('guests.import.file')}
          </h3>
          <UploadForm action={uploadImportAction.bind(null, id)} />
          <ul className="rules">
            {(['formats', 'firstSheet', 'values', 'nothingChanged'] as const).map((r) => (
              <li key={r}>
                <Icon name="check" />
                {t(`guests.import.rules.${r}`)}
              </li>
            ))}
          </ul>
        </section>

        <aside className="stack">
          <section className="panel stack-sm" aria-labelledby="tpl-h">
            <h3 id="tpl-h">{t('guests.import.templateTitle')}</h3>
            <p className="t-support">{t('guests.import.templateBody')}</p>
            <a href={`${base}/import/template`} className={buttonClass('secondary')} download>
              <Icon name="download" />
              {t('guests.template')}
            </a>
          </section>
          <section className="panel stack-sm" aria-labelledby="cols-h">
            <h3 id="cols-h">{t('guests.import.columnsTitle')}</h3>
            <dl className="columns-list">
              {IMPORT_FIELDS.map((f) => (
                <div key={f}>
                  <dt>
                    {TEMPLATE_HEADERS[f]}
                    <span className={`tag${REQUIRED_FIELDS.includes(f) ? ' tag-brand' : ''}`}>
                      {REQUIRED_FIELDS.includes(f)
                        ? t('guests.import.required')
                        : t('guests.import.optional')}
                    </span>
                  </dt>
                  <dd>
                    {t(`guests.import.columnHints.${f}`, { n: e.defaultAllowedCompanions })}
                    <span className="aliases">
                      {t('guests.import.aliases', {
                        names: HEADER_ALIASES[f]
                          .filter((a) => a !== TEMPLATE_HEADERS[f])
                          .join('، '),
                      })}
                    </span>
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </aside>
      </div>

      {recent.length > 0 && (
        <section className="section" aria-labelledby="recent-h">
          <div className="section-head">
            <h3 id="recent-h">{t('guests.import.recent')}</h3>
          </div>
          <ul className="import-history panel">
            {recent.map((b) => (
              <li key={b.id}>
                <Icon name="file" />
                <span className="grow">
                  <strong dir="auto">{b.originalFilename}</strong>
                  <span className="muted">
                    {t('guests.import.recentRow', {
                      rows: formatCount(b.rowCount),
                      when: formatShortDateTime(b.createdAt, e.timezone),
                    })}
                  </span>
                </span>
                <span className={`istate istate-${b.status}`}>
                  {t(`guests.import.state.${b.status}`)}
                </span>
                <Link href={`${base}/import/${b.id}`} className={buttonClass('link', 'sm')}>
                  {t('guests.import.open')}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
