import {
  formatPhone,
  getShareQueue,
  getShareText,
  isEditable,
  SHARE_PLACEHOLDERS,
  SHARE_QUEUE_FILTERS,
  SHARE_TEXT_MAX,
  type ShareQueueFilter,
} from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/button';
import { EmptyState } from '@/components/empty-state';
import { ActionForm, SubmitButton, TextArea } from '@/components/forms';
import { Icon } from '@/components/icons';
import { ShareButtons } from '@/components/sharing/share-buttons';
import { loadEventView } from '@/lib/events';
import { formatCount } from '@/lib/format';
import { UUID } from '@/lib/guests';
import { getCoreContext } from '@/lib/server';
import { recordShareAction } from '../lifecycle-actions';
import { saveShareTextAction } from './actions';

export const metadata: Metadata = { title: 'مشاركة الدعوات' };

/**
 * Manual sharing (V1): a share queue that walks guests one at a time with a WhatsApp button and a
 * prepared message, the editable message itself, and a links export. Nothing is sent by the app.
 */
export default async function MessagesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { principal, view } = await loadEventView(id);
  if (view.membership.role !== 'owner') notFound();
  const e = view.event;
  const ctx = getCoreContext();
  const t = await getTranslations();
  const filter: ShareQueueFilter = (SHARE_QUEUE_FILTERS as readonly string[]).includes(
    sp.filter ?? '',
  )
    ? (sp.filter as ShareQueueFilter)
    : 'not_shared';
  const after = sp.after && UUID.test(sp.after) ? sp.after : null;
  const [queue, text] = await Promise.all([
    getShareQueue(ctx, principal.user.id, id, { filter, after }),
    getShareText(ctx, principal.user.id, id),
  ]);
  const base = `/events/${id}/messages`;
  const href = (f: ShareQueueFilter, a?: string | null) => {
    const q = new URLSearchParams();
    if (f !== 'not_shared') q.set('filter', f);
    if (a) q.set('after', a);
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  const cur = queue.current;
  const textEditable = isEditable(e) && !e.disabledAt;

  return (
    <div className="stack-lg share-page">
      <div className="page-head">
        <div className="titles">
          <h2 className="t-title">{t('share.title')}</h2>
          <p className="t-support">{t('share.subtitle')}</p>
        </div>
        {queue.canShare && queue.counts.all > 0 && (
          <a href={`${base}/export`} className={buttonClass('secondary')} download>
            <Icon name="download" />
            {t('share.export')}
          </a>
        )}
      </div>

      {sp.done === 'text_saved' && (
        <p role="status" className="alert alert-ok">
          <Icon name="checkCircle" />
          <span className="grow">{t('share.textSaved')}</span>
        </p>
      )}
      {sp.e && (
        <p role="alert" className="alert alert-error">
          <Icon name="alert" />
          <span className="grow">
            {t.has(`errors.${sp.e}`) ? t(`errors.${sp.e}`) : t('errors.generic')}
          </span>
        </p>
      )}
      {!queue.canShare && (
        <p className="alert alert-neutral">
          <Icon name="info" />
          <span className="grow">
            {e.status === 'draft' ? t('share.draftNotice') : t('share.closedNotice')}
          </span>
        </p>
      )}

      <section className="panel share-queue" aria-labelledby="queue-h">
        <div className="section-head">
          <h3 id="queue-h" className="t-card">
            {t('share.queue.title')}
          </h3>
          <p className="field-hint">{t('share.queue.hint')}</p>
        </div>
        <nav className="segmented queue-filters" aria-label={t('share.queue.filters')}>
          {SHARE_QUEUE_FILTERS.map((f) => (
            <Link
              key={f}
              href={href(f)}
              aria-current={filter === f ? 'page' : undefined}
              scroll={false}
            >
              {t(`share.queue.filter.${f}`)}
              <span className="count">{formatCount(queue.counts[f])}</span>
            </Link>
          ))}
        </nav>

        {queue.counts.all === 0 ? (
          <EmptyState
            icon="users"
            title={t('share.queue.noGuests')}
            body={t('share.queue.noGuestsBody')}
            headingLevel={3}
            action={
              <Link href={`/events/${id}/guests`} className={buttonClass('primary')}>
                {t('share.queue.toGuests')}
              </Link>
            }
          />
        ) : !cur ? (
          <EmptyState
            icon="checkCircle"
            title={t(after ? 'share.queue.endTitle' : 'share.queue.emptyTitle')}
            body={t(after ? 'share.queue.endBody' : `share.queue.empty.${filter}`)}
            headingLevel={3}
            action={
              after ? (
                <Link href={href(filter)} className={buttonClass('secondary')}>
                  {t('share.queue.restart')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className="queue-card">
            <div className="queue-guest">
              <span className="avatar" aria-hidden="true">
                {cur.guestName.trim().charAt(0)}
              </span>
              <div className="grow">
                <p className="queue-name">{cur.guestName}</p>
                <p className="queue-meta">
                  <span dir="ltr" className="num">
                    {formatPhone(cur.phoneE164)}
                  </span>
                  {cur.groupName && <span>{cur.groupName}</span>}
                  <span
                    className={`share-state share-state-${cur.openedAt ? 'opened' : cur.shareCount > 0 ? 'shared' : 'not_shared'}`}
                  >
                    <span className="dot" aria-hidden="true" />
                    {t(
                      `guests.invite.${cur.openedAt ? 'opened' : cur.shareCount > 0 ? 'shared' : 'not_shared'}`,
                    )}
                  </span>
                </p>
              </div>
              <span className="queue-left">
                {t('share.queue.remaining', { count: queue.remaining })}
              </span>
            </div>
            <pre className="message-preview secret" dir="rtl">
              {cur.text}
            </pre>
            {queue.canShare && (
              <ShareButtons
                link={cur.link}
                text={cur.text}
                waUrl={cur.waUrl}
                record={recordShareAction.bind(null, id, cur.guestId)}
                onShared={href(filter, cur.guestId)}
              />
            )}
            <div className="row-tight queue-nav">
              <Link
                href={href(filter, cur.guestId)}
                className={buttonClass('ghost', 'sm')}
                scroll={false}
              >
                {t('share.queue.skip')}
                <Icon name="chevronOn" />
              </Link>
              <Link
                href={`/events/${id}/guests?guest=${cur.guestId}`}
                className={buttonClass('link', 'sm')}
              >
                {t('share.queue.openGuest')}
              </Link>
            </div>
          </div>
        )}
      </section>

      <section className="panel" id="share-text" aria-labelledby="text-h">
        <div className="section-head">
          <h3 id="text-h" className="t-card">
            {t('share.text.title')}
          </h3>
          {text.isDefault && <span className="tag">{t('share.text.default')}</span>}
        </div>
        <p className="field-hint">{t('share.text.hint')}</p>
        <ul className="placeholder-list" aria-label={t('share.text.placeholders')}>
          {SHARE_PLACEHOLDERS.map((p) => (
            <li key={p}>
              <code dir="ltr">{`{${p}}`}</code>
              <span>{t(`share.text.placeholder.${p}`)}</span>
            </li>
          ))}
        </ul>
        {textEditable ? (
          <ActionForm action={saveShareTextAction.bind(null, id)}>
            <TextArea
              name="body"
              label={t('share.text.label')}
              defaultValue={text.body}
              rows={9}
              maxLength={SHARE_TEXT_MAX}
              dir="rtl"
            />
            <div className="form-actions">
              <SubmitButton>{t('share.text.save')}</SubmitButton>
              {!text.isDefault && (
                <button
                  type="submit"
                  name="op"
                  value="reset"
                  className={buttonClass('ghost')}
                  formNoValidate
                >
                  {t('share.text.reset')}
                </button>
              )}
            </div>
          </ActionForm>
        ) : (
          <pre className="message-preview">{text.body}</pre>
        )}
      </section>
    </div>
  );
}
