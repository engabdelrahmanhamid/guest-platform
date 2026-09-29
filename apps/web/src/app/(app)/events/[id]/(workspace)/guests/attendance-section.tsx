import { getGuestAttendance } from '@gp/core';
import { randomUUID } from 'node:crypto';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { formatShortDateTime } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { correctAttendanceAction } from '../lifecycle-actions';

/**
 * The guest drawer's attendance: how many of the party are inside, every ledger row (who, when,
 * which device, why) and the owner's correction form while corrections are open. Hidden until
 * the guest is expected or has arrived.
 */
export async function AttendanceSection({
  userId,
  eventId,
  guestId,
  self,
  tz,
}: {
  userId: string;
  eventId: string;
  guestId: string;
  self: string;
  tz: string;
}) {
  const view = await getGuestAttendance(getCoreContext(), userId, eventId, guestId);
  if (view.history.length === 0 && !view.canCorrect) return null;
  const t = await getTranslations('lifecycle.attendance');
  return (
    <section className="drawer-section" aria-labelledby="gd-attendance">
      <div className="section-head">
        <h3 id="gd-attendance">{t('title')}</h3>
        <span className={`att att-${view.status}`}>
          {view.expected > 0
            ? t('inside', { inside: view.checkedIn, expected: view.expected })
            : t('insideWalkIn', { inside: view.checkedIn })}
        </span>
      </div>
      {view.history.length === 0 ? (
        <p className="field-hint">{t('none')}</p>
      ) : (
        <>
          <h4 className="sr-only">{t('history')}</h4>
          <ol className="timeline att-log">
            {view.history.map((h) => (
              <li key={h.id}>
                <span className="what">
                  <span className={`att-delta ${h.delta < 0 ? 'is-neg' : ''}`} dir="ltr">
                    {h.delta > 0 ? `+${h.delta}` : h.delta}
                  </span>{' '}
                  {t(h.action)} · {h.resulting}
                  {h.reason && <span className="att-reason">«{h.reason}»</span>}
                </span>
                <span className="when">
                  {formatShortDateTime(h.at, tz)} · {t('by', { name: h.by })}
                  {h.device && ` · ${h.device}`}
                </span>
              </li>
            ))}
          </ol>
        </>
      )}
      {view.canCorrect && (
        <details className="att-fix">
          <summary>{t('correctTitle')}</summary>
          <ActionForm action={correctAttendanceAction.bind(null, eventId, guestId)}>
            <input type="hidden" name="returnTo" value={self} />
            <input type="hidden" name="idempotencyKey" value={randomUUID()} />
            <p className="field-hint">{t('correctHint')}</p>
            <Field
              name="delta"
              label={t('delta')}
              inputMode="numeric"
              dir="ltr"
              required
              pattern="[+-]?[0-9]+"
            />
            <Field name="reason" label={t('reason')} required maxLength={300} />
            <SubmitButton variant="secondary" size="sm">
              {t('submit')}
            </SubmitButton>
          </ActionForm>
        </details>
      )}
    </section>
  );
}
