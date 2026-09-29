import type { GuestPageView } from '@gp/core';
import { getTranslations } from 'next-intl/server';
import type { CSSProperties, ReactNode } from 'react';
import { formatDate, formatTime, partyText } from '@/lib/format';
import { Countdown } from './countdown';
import { amiri, elMessiri } from './fonts';
import { CompanionStepper } from './stepper';
import '@/styles/invite.css';

type Respond = (formData: FormData) => Promise<void>;

export interface ExperienceProps {
  view: GuestPageView;
  /** The server action that saves an answer; absent in the owner's preview. */
  respond: Respond | null;
  qrSvg: string | null;
  now: Date;
  /** `saved=` after an answer was stored, `e=` when it wasn't. */
  saved?: string | null;
  error?: string | null;
  /** A preview banner (owner only). */
  banner?: ReactNode;
}

const ORNAMENT: Record<string, ReactNode> = {
  elegant: (
    <svg viewBox="0 0 120 16" aria-hidden="true" className="inv-ornament">
      <path d="M2 8h44M74 8h44" />
      <path d="M60 2l6 6-6 6-6-6z" />
      <circle cx="50" cy="8" r="1.6" />
      <circle cx="70" cy="8" r="1.6" />
    </svg>
  ),
  celebration: (
    <svg viewBox="0 0 120 16" aria-hidden="true" className="inv-ornament">
      <circle cx="30" cy="8" r="2.4" />
      <circle cx="45" cy="8" r="1.6" />
      <path d="M60 1.5l1.9 4.4 4.6.4-3.5 3 1.1 4.6-4.1-2.5-4.1 2.5 1.1-4.6-3.5-3 4.6-.4z" />
      <circle cx="75" cy="8" r="1.6" />
      <circle cx="90" cy="8" r="2.4" />
    </svg>
  ),
  formal: (
    <svg viewBox="0 0 120 16" aria-hidden="true" className="inv-ornament">
      <path d="M30 8h60" />
    </svg>
  ),
  minimal: null,
};

function mediaUrl(key: string | null) {
  return key ? `/media/${key}` : null;
}

/**
 * The guest's invitation page: visual, welcome, event details, answer, location, pass. One
 * component for the real page and the owner's preview, so the preview can't drift.
 */
export async function GuestExperience({
  view,
  respond,
  qrSvg,
  now,
  saved,
  error,
  banner,
}: ExperienceProps) {
  const t = await getTranslations('invite');
  const { event, design, guest, rsvp, pass, state } = view;
  const tz = event.timezone;
  const cover = mediaUrl(event.coverImageKey);
  const logo = mediaUrl(event.logoKey);
  const style = { '--inv-accent': design.primaryColor } as CSSProperties;
  const rootClass = [
    'inv',
    `inv--${design.template}`,
    cover ? 'inv--has-cover' : 'inv--no-cover',
    design.template === 'elegant' ? amiri.variable : '',
    design.template === 'celebration' ? elMessiri.variable : '',
  ].join(' ');
  const preview = respond === null;

  if (state === 'unavailable') {
    return (
      <main className="inv inv--minimal inv--plain" style={style}>
        {banner}
        <section className="inv-notice">
          <h1>{t('unavailableTitle')}</h1>
          <p>{t('unavailableBody')}</p>
        </section>
      </main>
    );
  }

  const showCountdown =
    design.showCountdown && state === 'open' && event.startsAt.getTime() > now.getTime();
  const details = [
    design.showDate && { label: t('date'), value: formatDate(event.startsAt, tz), icon: 'date' },
    design.showTime && { label: t('time'), value: formatTime(event.startsAt, tz), icon: 'time' },
    design.showVenue && {
      label: t('venue'),
      value: [event.venueName, event.city].filter(Boolean).join('، '),
      icon: 'venue',
    },
  ].filter((d): d is { label: string; value: string; icon: string } => Boolean(d && d.value));
  const showLocation =
    state !== 'cancelled' &&
    ((design.showAddress && event.address) || (design.showMap && event.mapsUrl));

  return (
    <main className={rootClass} style={style} lang="ar" dir="rtl">
      {banner}

      <header className="inv-visual">
        {cover ? (
          <img
            className="inv-cover"
            src={cover}
            alt=""
            width={1600}
            height={900}
            fetchPriority="high"
          />
        ) : (
          <div className="inv-pattern" aria-hidden="true" />
        )}
        {logo && <img className="inv-logo" src={logo} alt="" width={96} height={96} />}
      </header>

      <div className="inv-sheet">
        <section className="inv-welcome" aria-labelledby="inv-title">
          {state === 'cancelled' ? (
            <>
              <p className="inv-kicker">{t('cancelledKicker')}</p>
              <h1 id="inv-title" className="inv-title">
                {t('cancelledTitle')}
              </h1>
              <p className="inv-lead">{t('cancelledBody', { event: event.name })}</p>
            </>
          ) : (
            <>
              {guest && <p className="inv-greeting">{t('greeting', { name: guest.fullName })}</p>}
              <p className="inv-kicker">
                {t(event.category === 'business' ? 'inviteLineBusiness' : 'inviteLine')}
              </p>
              {ORNAMENT[design.template]}
              <h1 id="inv-title" className="inv-title">
                {design.title}
              </h1>
              {design.bodyText && <p className="inv-message">{design.bodyText}</p>}
            </>
          )}
        </section>

        {state !== 'cancelled' &&
          (details.length > 0 ||
            showCountdown ||
            (design.showDescription && event.description)) && (
            <section className="inv-card inv-details" aria-label={t('detailsTitle')}>
              {details.length > 0 && (
                <dl className="inv-facts">
                  {details.map((d) => (
                    <div key={d.label} className={`inv-fact inv-fact--${d.icon}`}>
                      <dt>{d.label}</dt>
                      <dd>{d.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {design.showDescription && event.description && (
                <p className="inv-description">{event.description}</p>
              )}
              {showCountdown && (
                <Countdown
                  startsAt={event.startsAt.toISOString()}
                  serverNow={now.getTime()}
                  title={t('countdownTitle')}
                  labels={{ days: t('days'), hours: t('hours'), minutes: t('minutes') }}
                />
              )}
            </section>
          )}

        {guest && rsvp && (
          <Answer
            state={state}
            guest={guest}
            rsvp={rsvp}
            respond={respond}
            saved={saved ?? null}
            error={error ?? null}
            hasPass={Boolean(pass && pass.display === 'valid')}
            arrived={view.arrived}
            t={t}
          />
        )}

        {showLocation && (
          <section className="inv-card inv-location" aria-labelledby="inv-location-title">
            <h2 id="inv-location-title">{t('locationTitle')}</h2>
            {event.venueName && <p className="inv-venue">{event.venueName}</p>}
            {design.showAddress && event.address && <p className="inv-address">{event.address}</p>}
            {design.showMap && event.mapsUrl && (
              <a
                className="inv-btn inv-btn--ghost"
                href={event.mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('openMap')}
              </a>
            )}
          </section>
        )}

        {guest && rsvp?.status === 'confirmed' && pass && (
          <section className="inv-card inv-pass" id="pass" aria-labelledby="inv-pass-title">
            <div className="inv-pass-head">
              <h2 id="inv-pass-title">{t('passTitle')}</h2>
              <span className={`inv-pass-state inv-pass-state--${pass.display}`}>
                {t(`passState.${pass.display}`)}
              </span>
            </div>
            {pass.display === 'valid' && qrSvg ? (
              <div className="inv-qr" role="img" aria-label={t('qrLabel')}>
                <div dangerouslySetInnerHTML={{ __html: qrSvg }} />
                {preview && <span className="inv-qr-sample">{t('sampleQr')}</span>}
              </div>
            ) : (
              <p className="inv-pass-off">{t(`passOff.${pass.display}`)}</p>
            )}
            <dl className="inv-pass-facts">
              <div>
                <dt>{t('passGuest')}</dt>
                <dd>{guest.fullName}</dd>
              </div>
              <div>
                <dt>{t('passParty')}</dt>
                <dd>{t('people', { count: 1 + rsvp.companionCount })}</dd>
              </div>
              <div className="wide">
                <dt>{t('passEvent')}</dt>
                <dd>{event.name}</dd>
              </div>
              <div>
                <dt>{t('date')}</dt>
                <dd>{formatDate(event.startsAt, tz)}</dd>
              </div>
              <div>
                <dt>{t('time')}</dt>
                <dd>{formatTime(event.startsAt, tz)}</dd>
              </div>
              {event.venueName && (
                <div className="wide">
                  <dt>{t('venue')}</dt>
                  <dd>{event.venueName}</dd>
                </div>
              )}
            </dl>
            {pass.display === 'valid' && <p className="inv-hint">{t('passHint')}</p>}
          </section>
        )}

        <footer className="inv-foot">
          <p>{t('personalNote')}</p>
        </footer>
      </div>
    </main>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<'invite'>>>;

function Answer({
  state,
  guest,
  rsvp,
  respond,
  saved,
  error,
  hasPass,
  arrived,
  t,
}: {
  state: GuestPageView['state'];
  guest: NonNullable<GuestPageView['guest']>;
  rsvp: NonNullable<GuestPageView['rsvp']>;
  respond: Respond | null;
  saved: string | null;
  error: string | null;
  hasPass: boolean;
  arrived: number;
  t: T;
}) {
  // Once anyone of the party is inside, the answer can't change from here.
  const open = state === 'open' && arrived === 0;
  const closedNote = arrived > 0 ? t('arrivedNote') : t('closedNote');
  const disabled = respond === null;
  const allowed = guest.allowedCompanions;
  const confirmForm = (initial: number, label: string) => (
    <form action={respond ?? undefined} className="inv-form">
      <input type="hidden" name="status" value="confirmed" />
      {allowed > 0 && (
        <CompanionStepper
          name="companions"
          label={t('companionsLabel')}
          hint={t('companionsHint', { count: companionsLimit(allowed) })}
          max={allowed}
          initial={initial}
          fewer={t('fewer')}
          more={t('more')}
          disabled={disabled}
        />
      )}
      <button type="submit" className="inv-btn inv-btn--primary" disabled={disabled}>
        {label}
      </button>
    </form>
  );
  const declineForm = (label: string) => (
    <form action={respond ?? undefined} className="inv-form">
      <input type="hidden" name="status" value="declined" />
      <button type="submit" className="inv-btn inv-btn--quiet" disabled={disabled}>
        {label}
      </button>
    </form>
  );
  const errorText =
    error && (t.has(`errors.${error}`) ? t(`errors.${error}`) : t('errors.generic'));

  return (
    <section className="inv-card inv-answer" id="rsvp" aria-labelledby="inv-answer-title">
      {errorText && (
        <p className="inv-alert inv-alert--error" role="alert">
          {errorText}
        </p>
      )}
      {saved && !error && (
        <p className="inv-alert inv-alert--ok" role="status">
          {t('saved')}
        </p>
      )}

      {rsvp.status === 'pending' && (
        <>
          <h2 id="inv-answer-title">{t('question')}</h2>
          {open ? (
            <div className="inv-choices">
              {confirmForm(0, t('accept'))}
              {declineForm(t('decline'))}
            </div>
          ) : (
            <p className="inv-muted">{closedNote}</p>
          )}
        </>
      )}

      {rsvp.status === 'confirmed' && (
        <>
          <div className="inv-status inv-status--yes">
            <span className="inv-status-mark" aria-hidden="true">
              ✓
            </span>
            <div>
              <h2 id="inv-answer-title">{t('confirmedTitle')}</h2>
              <p>{partyText(rsvp.companionCount)}</p>
            </div>
          </div>
          {hasPass && (
            <a className="inv-btn inv-btn--primary" href="#pass">
              {t('goToPass')}
            </a>
          )}
          {open ? (
            <details className="inv-change">
              <summary>{t('changeAnswer')}</summary>
              <div className="inv-choices">
                {allowed > 0 && confirmForm(rsvp.companionCount, t('saveCompanions'))}
                {declineForm(t('decline'))}
              </div>
            </details>
          ) : (
            <p className="inv-muted">{closedNote}</p>
          )}
        </>
      )}

      {rsvp.status === 'declined' && (
        <>
          <div className="inv-status inv-status--no">
            <span className="inv-status-mark" aria-hidden="true">
              –
            </span>
            <div>
              <h2 id="inv-answer-title">{t('declinedTitle')}</h2>
              <p>{t('declinedBody')}</p>
            </div>
          </div>
          {open ? (
            <details className="inv-change">
              <summary>{t('changedMind')}</summary>
              <div className="inv-choices">{confirmForm(0, t('accept'))}</div>
            </details>
          ) : (
            <p className="inv-muted">{closedNote}</p>
          )}
        </>
      )}
    </section>
  );
}

/** "مرافق واحد", "مرافقَين", "3 مرافقين" — how many companions this guest may bring. */
function companionsLimit(n: number): string {
  if (n === 1) return 'مرافق واحد';
  if (n === 2) return 'مرافقَين';
  const mod = n % 100;
  return mod >= 3 && mod <= 10 ? `${n} مرافقين` : `${n} مرافقًا`;
}
