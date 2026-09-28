import { getGuestLifecycle, getShareContent, passQrSvg } from '@gp/core';
import { getTranslations } from 'next-intl/server';
import { buttonClass } from '@/components/button';
import { ConfirmSubmit } from '@/components/confirm-submit';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { Icon } from '@/components/icons';
import { ShareButtons } from '@/components/sharing/share-buttons';
import { formatCount, formatShortDateTime, partyText } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import {
  recordShareAction,
  replacePassAction,
  rotateLinkAction,
  setRsvpAction,
} from '../lifecycle-actions';

/**
 * The guest drawer's invitation, answer and pass sections. Kept apart: sharing a link, the
 * guest's answer and their pass are different things with different histories.
 */
export async function LifecycleSections({
  userId,
  eventId,
  guestId,
  guestActive,
  allowedCompanions,
  self,
  tz,
}: {
  userId: string;
  eventId: string;
  guestId: string;
  guestActive: boolean;
  allowedCompanions: number;
  self: string;
  tz: string;
}) {
  const t = await getTranslations('lifecycle');
  const ctx = getCoreContext();
  const life = await getGuestLifecycle(ctx, userId, eventId, guestId);
  const share = life.canShare ? await getShareContent(ctx, userId, eventId, guestId) : null;
  const { invitation: inv, rsvp, pass } = life;
  const current = pass.current;
  const qr = current?.display === 'valid' ? await passQrSvg(current.token) : null;
  const shareState = inv.openedAt ? 'opened' : inv.shareCount > 0 ? 'shared' : 'not_shared';
  const when = (d: Date | null) => (d ? formatShortDateTime(d, tz) : '—');

  return (
    <>
      <section className="drawer-section" aria-labelledby="gd-invitation">
        <div className="section-head">
          <h3 id="gd-invitation">{t('invitation.title')}</h3>
          <span className={`share-state share-state-${shareState}`}>
            <span className="dot" aria-hidden="true" />
            {t(`invitation.state.${shareState}`)}
          </span>
        </div>
        <div className="link-box">
          <label htmlFor="gd-link" className="sr-only">
            {t('invitation.link')}
          </label>
          <input id="gd-link" readOnly value={inv.link} dir="ltr" className="secret" />
        </div>
        {share ? (
          <ShareButtons
            link={share.link}
            text={share.text}
            waUrl={share.waUrl}
            record={recordShareAction.bind(null, eventId, guestId)}
            compact
          />
        ) : (
          <p className="field-hint">
            {guestActive ? t('invitation.shareClosed') : t('invitation.guestCancelled')}
          </p>
        )}
        <dl className="kv kv-compact">
          <dt>{t('invitation.shared')}</dt>
          <dd>
            {inv.shareCount > 0
              ? t('invitation.sharedTimes', {
                  count: inv.shareCount,
                  when: when(inv.lastSharedAt),
                })
              : t('invitation.notYet')}
          </dd>
          <dt>{t('invitation.opened')}</dt>
          <dd>
            {inv.openedAt
              ? t('invitation.openedTimes', {
                  count: inv.openCount,
                  first: when(inv.openedAt),
                  last: when(inv.lastOpenedAt),
                })
              : t('invitation.notYet')}
          </dd>
          {inv.tokenRotatedAt && (
            <>
              <dt>{t('invitation.rotated')}</dt>
              <dd>{when(inv.tokenRotatedAt)}</dd>
            </>
          )}
        </dl>
        <p className="field-hint">{t('invitation.sharedMeaning')}</p>
        <ActionForm
          action={rotateLinkAction.bind(null, eventId, guestId)}
          className="row-tight wrap"
        >
          <input type="hidden" name="returnTo" value={self} />
          <a
            href={`/events/${eventId}/preview?guest=${guestId}`}
            target="_blank"
            rel="noopener"
            className={buttonClass('ghost', 'sm')}
          >
            <Icon name="eye" />
            {t('invitation.preview')}
          </a>
          {guestActive && (
            <ConfirmSubmit
              name="op"
              value="rotate"
              variant="ghost"
              size="sm"
              confirm={t('invitation.rotateConfirm')}
            >
              <Icon name="refresh" />
              {t('invitation.rotate')}
            </ConfirmSubmit>
          )}
        </ActionForm>
      </section>

      <section className="drawer-section" aria-labelledby="gd-rsvp">
        <div className="section-head">
          <h3 id="gd-rsvp">{t('rsvp.title')}</h3>
          <span className={`rsvp rsvp-${rsvp.status}`}>{t(`rsvp.status.${rsvp.status}`)}</span>
        </div>
        <dl className="kv kv-compact">
          <dt>{t('rsvp.companions')}</dt>
          <dd>
            {rsvp.status === 'confirmed'
              ? t('rsvp.companionsOf', {
                  count: formatCount(rsvp.companionCount),
                  allowed: formatCount(allowedCompanions),
                })
              : t('rsvp.allowed', { allowed: formatCount(allowedCompanions) })}
          </dd>
          <dt>{t('rsvp.partySize')}</dt>
          <dd>
            {rsvp.status === 'confirmed'
              ? `${formatCount(rsvp.partySize)} · ${partyText(rsvp.companionCount).replace('أنت', t('rsvp.theGuest'))}`
              : '—'}
          </dd>
          <dt>{t('rsvp.answered')}</dt>
          <dd>
            {rsvp.respondedAt
              ? t(rsvp.by === 'member' ? 'rsvp.byMember' : 'rsvp.byGuest', {
                  when: when(rsvp.respondedAt),
                  name: rsvp.byName ?? '',
                })
              : t('rsvp.noAnswer')}
          </dd>
        </dl>
        {life.canChangeRsvp ? (
          <details className="inline-edit">
            <summary className={buttonClass('secondary', 'sm')}>
              <Icon name="edit" />
              {t('rsvp.record')}
            </summary>
            <ActionForm
              action={setRsvpAction.bind(null, eventId, guestId)}
              className="form compact"
            >
              <input type="hidden" name="returnTo" value={self} />
              <p className="field-hint">{t('rsvp.recordHint')}</p>
              <fieldset className="radio-row">
                <legend className="sr-only">{t('rsvp.title')}</legend>
                <label className="radio-choice">
                  <input
                    type="radio"
                    name="status"
                    value="confirmed"
                    defaultChecked={rsvp.status !== 'declined'}
                  />
                  <span>{t('rsvp.status.confirmed')}</span>
                </label>
                <label className="radio-choice">
                  <input
                    type="radio"
                    name="status"
                    value="declined"
                    defaultChecked={rsvp.status === 'declined'}
                  />
                  <span>{t('rsvp.status.declined')}</span>
                </label>
              </fieldset>
              {allowedCompanions > 0 && (
                <Field
                  name="companions"
                  type="number"
                  label={t('rsvp.companionsField')}
                  hint={t('rsvp.companionsHint', { allowed: formatCount(allowedCompanions) })}
                  min={0}
                  max={allowedCompanions}
                  defaultValue={String(rsvp.status === 'confirmed' ? rsvp.companionCount : 0)}
                  inputMode="numeric"
                />
              )}
              <SubmitButton size="sm">{t('rsvp.save')}</SubmitButton>
            </ActionForm>
          </details>
        ) : (
          <p className="field-hint">
            {guestActive ? t('rsvp.closed') : t('invitation.guestCancelled')}
          </p>
        )}
      </section>

      <section className="drawer-section" aria-labelledby="gd-pass">
        <div className="section-head">
          <h3 id="gd-pass">{t('pass.title')}</h3>
          {current && (
            <span className={`pass-state pass-state-${current.display}`}>
              {t(`pass.display.${current.display}`)}
            </span>
          )}
        </div>
        {!current ? (
          <p className="field-hint">{t('pass.none')}</p>
        ) : (
          <div className="pass-row">
            {qr && (
              <div
                className="pass-qr secret"
                role="img"
                aria-label={t('pass.qr')}
                dangerouslySetInnerHTML={{ __html: qr }}
              />
            )}
            <dl className="kv kv-compact">
              <dt>{t('pass.issued')}</dt>
              <dd>{when(current.issuedAt)}</dd>
              {current.revokedAt && (
                <>
                  <dt>{t('pass.revoked')}</dt>
                  <dd>
                    {when(current.revokedAt)}
                    {current.revokeReason && ` · ${t(`pass.reason.${current.revokeReason}`)}`}
                  </dd>
                </>
              )}
              <dt>{t('pass.history')}</dt>
              <dd>{t('pass.issuedCount', { count: pass.issuedCount })}</dd>
            </dl>
          </div>
        )}
        <p className="field-hint">{t('pass.note')}</p>
        {current?.display === 'valid' && life.canChangeRsvp && (
          <ActionForm action={replacePassAction.bind(null, eventId, guestId)}>
            <input type="hidden" name="returnTo" value={self} />
            <ConfirmSubmit
              name="op"
              value="replace"
              variant="ghost"
              size="sm"
              confirm={t('pass.replaceConfirm')}
            >
              <Icon name="refresh" />
              {t('pass.replace')}
            </ConfirmSubmit>
          </ActionForm>
        )}
      </section>
    </>
  );
}
