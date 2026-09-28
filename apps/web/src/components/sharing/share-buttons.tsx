'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState, useTransition } from 'react';
import { buttonClass } from '../button';
import { Icon } from '../icons';

type RecordShare = (method: string) => Promise<{ ok: true } | { ok: false; error: string }>;

/**
 * Hand an invitation off: open WhatsApp with the prepared message, or copy the link or the
 * message. Each records "shared" on the server afterwards. Without JavaScript the WhatsApp
 * button is still a working link.
 */
export function ShareButtons({
  link,
  text,
  waUrl,
  record,
  compact,
  onShared,
}: {
  link: string;
  text: string;
  waUrl: string | null;
  record: RecordShare;
  compact?: boolean;
  /** Where to go after a successful share (the share queue moves to the next guest). */
  onShared?: string;
}) {
  const t = useTranslations('sharing');
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const done = (method: string, copied: boolean) =>
    start(async () => {
      const res = await record(method);
      if (!res.ok) {
        setNote({
          ok: false,
          text: t.has(`errors.${res.error}`) ? t(`errors.${res.error}`) : t('errors.generic'),
        });
        return;
      }
      setNote({ ok: true, text: copied ? t('copiedRecorded') : t('openedRecorded') });
      if (onShared) router.push(onShared, { scroll: false });
      else router.refresh();
    });

  const copy = async (value: string, method: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      setNote({ ok: false, text: t('copyFailed') });
      return;
    }
    done(method, true);
  };

  const size = compact ? 'sm' : undefined;
  return (
    <div className="share-buttons">
      <div className="row-tight wrap">
        {waUrl ? (
          <a
            href={waUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`${buttonClass('primary', size)} wa-btn`}
            onClick={() => done('whatsapp', false)}
            aria-disabled={pending || undefined}
          >
            <Icon name="chat" />
            {t('whatsapp')}
          </a>
        ) : (
          <span className="muted small">{t('noPhone')}</span>
        )}
        <button
          type="button"
          className={buttonClass('secondary', size)}
          onClick={() => copy(link, 'copy_link')}
          disabled={pending}
        >
          <Icon name="link" />
          {t('copyLink')}
        </button>
        <button
          type="button"
          className={buttonClass('secondary', size)}
          onClick={() => copy(text, 'copy_text')}
          disabled={pending}
        >
          <Icon name="file" />
          {t('copyText')}
        </button>
      </div>
      <p
        className={`share-note ${note && !note.ok ? 'is-error' : ''}`}
        role="status"
        aria-live="polite"
      >
        {note?.text ?? ''}
      </p>
    </div>
  );
}
