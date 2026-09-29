'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from '../forms';
import { buttonClass } from '../button';
import { Icon } from '../icons';

type Action = (prev: FormState, data: FormData) => Promise<FormState>;

function Submit({ label, variant }: { label: string; variant: 'primary' | 'secondary' }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={buttonClass(variant, 'sm')}
      disabled={pending}
      aria-busy={pending || undefined}
    >
      <Icon name="link" />
      {label}
    </button>
  );
}

/**
 * Send, re-send or stop one staff member's door access. A new link is shown here once, with
 * WhatsApp and copy; re-sending first asks, because it signs the member's devices out.
 */
export function TeamAccess({
  membershipId,
  name,
  hasAccess,
  canSend,
  send,
  revoke,
}: {
  membershipId: string;
  name: string;
  /** A link is waiting or a device is signed in. */
  hasAccess: boolean;
  canSend: boolean;
  send: Action;
  revoke: Action;
}) {
  const t = useTranslations('checkin.team');
  const te = useTranslations('errors');
  const [sent, sendAction] = useActionState(send, {});
  const [revoked, revokeAction] = useActionState(revoke, {});
  const [asking, setAsking] = useState<'resend' | 'revoke' | null>(null);
  const [hidden, setHidden] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const link = sent.ok && sent.data?.url && hidden !== sent.data.url ? sent.data : null;
  const error = sent.error ?? revoked.error;

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setNote(t('copied'));
    } catch {
      setNote(t('copyFailed'));
    }
  };

  return (
    <div className="team-access">
      {error && (
        <p role="alert" className="field-error">
          <Icon name="alert" />
          {te.has(error) ? te(error) : te('generic')}
        </p>
      )}
      {revoked.ok && revoked.message && !link && (
        <p role="status" className="field-hint">
          {revoked.message === 'nothingToRevoke' ? t('nothingToRevoke') : t('revoked', { name })}
        </p>
      )}

      {link ? (
        <div className="team-link" role="status">
          <strong>{t('linkReady', { name })}</strong>
          <p>{t('linkOnce', { name })}</p>
          <code dir="ltr">{link.url}</code>
          <div className="row-tight wrap">
            {link.waUrl && (
              <a
                href={link.waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={`${buttonClass('primary', 'sm')} wa-btn`}
              >
                <Icon name="chat" />
                {t('whatsapp')}
              </a>
            )}
            <button
              type="button"
              className={buttonClass('secondary', 'sm')}
              onClick={() => void copy(link.url!)}
            >
              <Icon name="link" />
              {t('copy')}
            </button>
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => {
                setHidden(link.url!);
                setNote(null);
              }}
            >
              {t('done')}
            </button>
          </div>
          {note && (
            <p className="field-hint" aria-live="polite">
              {note}
            </p>
          )}
        </div>
      ) : asking ? (
        <div className="team-ask">
          <p>{t(asking === 'resend' ? 'resendConfirm' : 'revokeConfirm', { name })}</p>
          <div className="row-tight wrap">
            <form
              action={asking === 'resend' ? sendAction : revokeAction}
              onSubmit={() => setAsking(null)}
            >
              <input type="hidden" name="membershipId" value={membershipId} />
              <button
                type="submit"
                className={buttonClass(asking === 'revoke' ? 'danger' : 'primary', 'sm')}
              >
                {t(asking)}
              </button>
            </form>
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => setAsking(null)}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      ) : (
        <div className="row-tight wrap">
          {canSend &&
            (hasAccess ? (
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => setAsking('resend')}
              >
                <Icon name="refresh" />
                {t('resend')}
              </button>
            ) : (
              <form action={sendAction}>
                <input type="hidden" name="membershipId" value={membershipId} />
                <Submit label={t('send')} variant="primary" />
              </form>
            ))}
          {hasAccess && (
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => setAsking('revoke')}
            >
              <Icon name="ban" />
              {t('revoke')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
