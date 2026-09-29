'use client';

import type {
  DoorTeamMember,
  DoorDuplicate,
  DoorGuest,
  DoorOverview,
  DoorSearchRow,
  DoorWriteResult,
  QrLookup,
  WalkInResult,
} from '@gp/core';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DoorResult } from '@/app/scan/[eventId]/actions';
import { formatTime } from '@/lib/format';
import { buttonClass } from '../button';
import { Icon } from '../icons';
import { Camera } from './camera';

export interface DoorActions {
  overview: () => Promise<DoorResult<DoorOverview>>;
  lookup: (payload: string) => Promise<DoorResult<QrLookup>>;
  search: (query: string) => Promise<DoorResult<DoorSearchRow[]>>;
  guest: (guestId: string) => Promise<DoorResult<DoorGuest>>;
  checkIn: (input: {
    guestId: string;
    count: number;
    method: 'qr' | 'search';
    passId?: string;
    idempotencyKey: string;
  }) => Promise<DoorResult<DoorWriteResult>>;
  correct: (input: {
    guestId: string;
    delta: number;
    reason: string;
    idempotencyKey: string;
  }) => Promise<DoorResult<DoorWriteResult>>;
  confirm: (guestId: string, companions: number) => Promise<DoorResult<DoorWriteResult>>;
  walkIn: (input: {
    fullName: string;
    phone: string;
    partySize: number;
    allowDuplicate: boolean;
    idempotencyKey: string;
  }) => Promise<DoorResult<WalkInResult>>;
  team: () => Promise<DoorResult<DoorTeamMember[]>>;
  resend: (
    membershipId: string,
  ) => Promise<DoorResult<{ url: string; waUrl: string | null; name: string }>>;
  revoke: (membershipId: string) => Promise<DoorResult<{ changed: boolean }>>;
}

type Tab = 'scan' | 'search' | 'walkIn' | 'team';
type Toast = { tone: 'ok' | 'warn' | 'error'; text: string };
type Card = { guest: DoorGuest; method: 'qr' | 'search' };
/** A write that didn't get an answer. Retrying sends the same idempotency key. */
type Unsent = { retry: () => Promise<void> };

const POLL_MS = 15_000;
/** The same pass is read again only after it has been out of view this long. */
const SAME_CODE_GONE_MS = 1500;

function newKey(): string {
  return crypto.randomUUID();
}

function buzz(pattern: number | number[]) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // Not every phone vibrates.
  }
}

/**
 * The door. Scan a pass (or search, or register a walk-in), see the guest's party and what's
 * left, and admit some or all of them. Every write carries an idempotency key made when the
 * button is pressed, so a retry after a lost connection is always safe.
 */
export function Scanner({
  initial,
  isStaff,
  actions,
  signOut,
}: {
  initial: DoorOverview;
  isStaff: boolean;
  actions: DoorActions;
  signOut: () => Promise<void>;
}) {
  const t = useTranslations('door');
  const te = useTranslations('errors');
  const [overview, setOverview] = useState(initial);
  const [tab, setTab] = useState<Tab>('scan');
  const [card, setCard] = useState<Card | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busy, setBusy] = useState(false);
  const [unsent, setUnsent] = useState<Unsent | null>(null);
  const [online, setOnline] = useState(true);
  const [ended, setEnded] = useState(false);
  const lastCode = useRef<{ text: string; seen: number } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { event, member, can } = overview;
  const tz = event.timezone;

  const people = (n: number) => t('people', { count: n });
  const errorText = (code: string) => (te.has(code) ? te(code) : te('generic'));

  const show = useCallback((next: Toast) => {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), next.tone === 'ok' ? 3500 : 6000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await actions.overview();
      if (res.ok) setOverview(res.data);
      else if (res.error === 'staff_session_invalid' || res.error === 'forbidden') setEnded(true);
      setOnline(true);
    } catch {
      setOnline(false);
    }
  }, [actions]);

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    setOnline(navigator.onLine);
    return () => {
      clearInterval(id);
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, [refresh]);

  /**
   * Runs a call to the server. A thrown call (no connection, server unreachable) returns null
   * and, for writes, keeps the call so it can be retried as is.
   */
  const call = useCallback(
    async <T,>(fn: () => Promise<DoorResult<T>>, write: boolean): Promise<DoorResult<T> | null> => {
      setBusy(true);
      try {
        const res = await fn();
        setOnline(true);
        if (write) setUnsent(null);
        if (!res.ok && res.error === 'staff_session_invalid') setEnded(true);
        return res;
      } catch {
        setOnline(false);
        if (!write) show({ tone: 'error', text: te('offline') });
        return null;
      } finally {
        setBusy(false);
      }
    },
    [show, te],
  );

  const openGuest = useCallback(
    async (guestId: string, method: 'qr' | 'search') => {
      const res = await call(() => actions.guest(guestId), false);
      if (!res) return;
      if (res.ok) setCard({ guest: res.data, method });
      else show({ tone: 'error', text: errorText(res.error) });
    },
    [actions, call, show],
  );

  const onCode = useCallback(
    async (text: string) => {
      const now = Date.now();
      if (busy || card) return;
      // A pass held in front of the camera is read once; it opens again only after it has
      // left the view (the next guest, or the same pass shown again later).
      const last = lastCode.current;
      if (last && last.text === text) {
        const away = now - last.seen > SAME_CODE_GONE_MS;
        last.seen = now;
        if (!away) return;
      }
      lastCode.current = { text, seen: now };
      const res = await call(() => actions.lookup(text), false);
      if (!res) return;
      if (!res.ok) {
        show({ tone: 'error', text: errorText(res.error) });
        return;
      }
      if (!res.data.found) {
        buzz([80, 60, 80]);
        show({ tone: 'error', text: t('camera.unknownCode') });
        return;
      }
      buzz(40);
      setCard({ guest: res.data.guest, method: 'qr' });
    },
    [actions, busy, call, card, show, t],
  );

  /** Sends a write; on a lost connection it stays retryable with the same key. */
  const write = useCallback(
    async <T,>(fn: () => Promise<DoorResult<T>>, done: (res: DoorResult<T>) => void) => {
      const attempt = async () => {
        const res = await call(fn, true);
        if (!res) {
          setUnsent({ retry: attempt });
          return;
        }
        done(res);
        void refresh();
      };
      await attempt();
    },
    [call, refresh],
  );

  const goneOffline = useCallback(() => setOnline(false), []);
  const searchFailed = useCallback(
    (code: string) => {
      if (code === 'staff_session_invalid') setEnded(true);
      else show({ tone: 'error', text: te.has(code) ? te(code) : te('generic') });
    },
    [show, te],
  );

  /** Closing a card restarts the "out of view" clock, so the pass still in view isn't re-read. */
  const closeCard = () => {
    if (lastCode.current) lastCode.current.seen = Date.now();
    setCard(null);
  };

  const afterWriteError = (guestId: string, code: string, method: 'qr' | 'search') => {
    show({ tone: 'error', text: errorText(code) });
    // The guest changed under us (another door admitted them): show the fresh state.
    if (
      [
        'party_complete',
        'count_over_remaining',
        'not_confirmed',
        'guest_not_active',
        'pass_revoked',
      ].includes(code)
    ) {
      void openGuest(guestId, method);
    }
  };

  const admit = (c: Card, count: number) => {
    const input = {
      guestId: c.guest.guestId,
      count,
      method: c.method,
      ...(c.method === 'qr' && c.guest.scannedPass ? { passId: c.guest.scannedPass.id } : {}),
      idempotencyKey: newKey(),
    };
    void write(
      () => actions.checkIn(input),
      (res) => {
        if (!res.ok) return afterWriteError(c.guest.guestId, res.error, c.method);
        buzz(60);
        closeCard();
        show({
          tone: res.data.replayed ? 'warn' : 'ok',
          text: res.data.replayed
            ? t('card.replayed')
            : `${res.data.guest.name}: ${t('card.admitted', { people: t('peopleOf', { count }) })}`,
        });
      },
    );
  };

  const correct = (c: Card, delta: number, reason: string) => {
    const input = { guestId: c.guest.guestId, delta, reason, idempotencyKey: newKey() };
    void write(
      () => actions.correct(input),
      (res) => {
        if (!res.ok) return show({ tone: 'error', text: errorText(res.error) });
        setCard({ ...c, guest: res.data.guest });
        show({ tone: 'ok', text: t('correct.done', { count: res.data.guest.checkedIn }) });
      },
    );
  };

  const confirm = (c: Card, companions: number) => {
    void write(
      () => actions.confirm(c.guest.guestId, companions),
      (res) => {
        if (!res.ok) return show({ tone: 'error', text: errorText(res.error) });
        setCard({ ...c, guest: res.data.guest });
        show({ tone: 'ok', text: t('confirm.done') });
      },
    );
  };

  if (ended) {
    return (
      <main className="door-entry">
        <section className="door-entry-card">
          <span className="door-entry-glyph is-muted">
            <Icon name="key" />
          </span>
          <h1>{t('signedOut.title')}</h1>
          <p className="door-entry-body">{te('staff_session_invalid')}</p>
        </section>
      </main>
    );
  }

  const live = event.status === 'live';
  const { checkedInPeople, expectedPeople, walkInPeople } = overview.totals;
  const role = member.role === 'owner' ? 'owner' : member.isSupervisor ? 'supervisor' : 'staff';

  return (
    <div className="door">
      <header className="door-head">
        <div className="door-head-row">
          <div className="door-event">
            <h1>{event.name}</h1>
            <p>
              {member.name} · {t(`header.${role}`)}
            </p>
          </div>
          {isStaff ? (
            <form
              action={signOut}
              onSubmit={(e) => {
                if (!window.confirm(t('header.signOutConfirm'))) e.preventDefault();
              }}
            >
              <button type="submit" className="door-signout">
                <Icon name="logout" />
                {t('header.signOut')}
              </button>
            </form>
          ) : (
            <a href={`/events/${event.id}/checkin`} className="door-signout">
              <Icon name="chevronBack" />
              {t('header.backToEvent')}
            </a>
          )}
        </div>
        <div className="door-count" aria-live="polite">
          <span className="door-count-n">{checkedInPeople}</span>
          <span className="door-count-label">
            <strong>{t('header.inside')}</strong>
            <span>{t('header.ofExpected', { expected: expectedPeople })}</span>
            {walkInPeople > 0 && <span>{t('header.walkIns', { count: walkInPeople })}</span>}
          </span>
          <span
            className="door-meter"
            role="presentation"
            style={{
              ['--fill' as string]: `${expectedPeople ? Math.min(100, ((checkedInPeople - walkInPeople) / expectedPeople) * 100) : 0}%`,
            }}
          />
        </div>
      </header>

      <main className="door-body">
        {!live && (
          <p className="alert alert-warn">
            <Icon name="clock" />
            <span className="grow">
              {event.status === 'active' ? t('header.notLive') : t('header.closed')}
              {event.status === 'active' && (
                <span className="block">
                  {t('header.opensAt', { time: formatTime(new Date(event.checkinOpensAt), tz) })}
                </span>
              )}
            </span>
          </p>
        )}
        <nav className="door-tabs" aria-label={t('tabs.label')}>
          {(
            [
              'scan',
              'search',
              ...(can.walkIn ? (['walkIn'] as const) : []),
              ...(can.manageAccess ? (['team'] as const) : []),
            ] as Tab[]
          ).map((k) => (
            <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>
              <Icon
                name={
                  k === 'scan'
                    ? 'qr'
                    : k === 'search'
                      ? 'search'
                      : k === 'walkIn'
                        ? 'plus'
                        : 'users'
                }
              />
              {t(`tabs.${k}`)}
            </button>
          ))}
        </nav>

        {tab === 'scan' && <Camera paused={busy || card !== null} onCode={(c) => void onCode(c)} />}
        {tab === 'search' && (
          <Search
            actions={actions}
            onPick={(id) => void openGuest(id, 'search')}
            onOffline={goneOffline}
            onFail={searchFailed}
          />
        )}
        {tab === 'team' && can.manageAccess && (
          <Team actions={actions} isStaff={isStaff} onFail={searchFailed} onOffline={goneOffline} />
        )}
        {tab === 'walkIn' && can.walkIn && (
          <WalkIn
            disabled={busy || !live}
            submit={(input, onDuplicate) =>
              write(
                () => actions.walkIn(input),
                (res) => {
                  if (!res.ok) {
                    show({ tone: 'error', text: errorText(res.error) });
                    return;
                  }
                  if (res.data.status === 'duplicate') return onDuplicate(res.data.duplicates);
                  buzz(60);
                  onDuplicate(null);
                  show({
                    tone: res.data.replayed ? 'warn' : 'ok',
                    text: t('walkIn.done', {
                      name: res.data.guest.name,
                      people: people(res.data.guest.checkedIn),
                    }),
                  });
                },
              )
            }
            openGuest={(id) => void openGuest(id, 'search')}
          />
        )}
      </main>

      {card && (
        <GuestCard
          key={`${card.guest.guestId}:${card.guest.checkedIn}:${card.guest.rsvpStatus}`}
          card={card}
          tz={tz}
          busy={busy}
          onClose={closeCard}
          onAdmit={(n) => admit(card, n)}
          onCorrect={(d, r) => correct(card, d, r)}
          onConfirm={(n) => confirm(card, n)}
        />
      )}

      {/* Above the guest card, so a retry is always reachable. */}
      {(!online || unsent) && (
        <div className="door-alerts">
          <div className="door-offline" role="alert">
            <Icon name="alert" />
            <div className="grow">
              <strong>{t('offline.title')}</strong>
              {unsent && (
                <span className="block">
                  {t('offline.pending')} {t('offline.safe')}
                </span>
              )}
            </div>
            {unsent && (
              <div className="row-tight">
                <button
                  type="button"
                  className={buttonClass('primary', 'sm')}
                  disabled={busy}
                  onClick={() => void unsent.retry()}
                >
                  <Icon name="refresh" />
                  {t('offline.retry')}
                </button>
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => setUnsent(null)}
                >
                  {t('offline.discard')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="door-toast-wrap" aria-live="assertive">
        {toast && (
          <p className={`door-toast is-${toast.tone}`} role="status">
            <Icon name={toast.tone === 'ok' ? 'checkCircle' : 'alert'} />
            {toast.text}
          </p>
        )}
      </div>
    </div>
  );
}

/** Group and masked phone; the phone reads left to right inside Arabic text. */
function Who({ group, phone }: { group: string | null; phone: string | null }) {
  return (
    <>
      {group}
      {group && phone && ' · '}
      {phone && <bdi dir="ltr">{phone}</bdi>}
    </>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
  label,
  signed,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  label: string;
  signed?: boolean;
}) {
  const t = useTranslations('door.card');
  return (
    <div className="door-stepper" role="group" aria-label={label}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={t('fewer')}
      >
        −
      </button>
      <output aria-live="polite">{signed && value > 0 ? `+${value}` : value}</output>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={t('more')}
      >
        +
      </button>
    </div>
  );
}

function GuestCard({
  card,
  tz,
  busy,
  onClose,
  onAdmit,
  onCorrect,
  onConfirm,
}: {
  card: Card;
  tz: string;
  busy: boolean;
  onClose: () => void;
  onAdmit: (count: number) => void;
  onCorrect: (delta: number, reason: string) => void;
  onConfirm: (companions: number) => void;
}) {
  const t = useTranslations('door');
  const g = card.guest;
  const [count, setCount] = useState(Math.max(1, g.remaining));
  const [companions, setCompanions] = useState(g.allowedCompanions);
  const [correcting, setCorrecting] = useState(false);
  const [delta, setDelta] = useState(g.checkedIn > 0 ? -1 : 1);
  const [reason, setReason] = useState('');
  const people = (n: number) => t('people', { count: n });
  const blocker =
    g.blocker === 'pass_revoked' && g.scannedPass?.replaced ? 'pass_replaced' : g.blocker;
  const tone = !blocker ? 'ok' : blocker === 'party_complete' ? 'warn' : 'error';
  const canFixCount = g.canCorrect && (g.checkedIn > 0 || g.remaining > 0);
  const deltaMin = -g.checkedIn;
  const deltaMax = g.remaining;

  return (
    <div className="door-sheet-backdrop" onClick={onClose}>
      <section
        className={`door-sheet is-${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guest-h"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="door-sheet-head">
          <div>
            <h2 id="guest-h">{g.name}</h2>
            <p className="door-sub">
              <Who group={g.group} phone={g.maskedPhone} />
              {g.walkIn && <span className="tag">{t('card.walkIn')}</span>}
              {g.guestStatus === 'cancelled' && <span className="tag">{t('card.cancelled')}</span>}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('card.close')}>
            <Icon name="x" />
          </button>
        </div>

        {g.expected > 0 && (
          <dl className="door-party">
            <div>
              <dt>{t('card.expected')}</dt>
              <dd>{g.expected}</dd>
            </div>
            <div>
              <dt>{t('card.inside')}</dt>
              <dd>{g.checkedIn}</dd>
            </div>
            <div className="is-key">
              <dt>{t('card.remaining')}</dt>
              <dd>{g.remaining}</dd>
            </div>
          </dl>
        )}

        {blocker && (
          <p className={`door-verdict is-${tone}`} role="alert">
            <Icon name={tone === 'warn' ? 'info' : 'ban'} />
            <span>
              {t(`blockers.${blocker}`)}
              {blocker === 'not_confirmed' && !g.canConfirm && ` ${t('card.askSupervisor')}`}
            </span>
          </p>
        )}
        {g.last && (
          <p className="door-last">
            {t('card.last', {
              people: people(g.last.count),
              time: formatTime(new Date(g.last.at), tz),
              by: g.last.by,
            })}
          </p>
        )}

        {!blocker && g.remaining > 0 && (
          <div className="door-admit">
            <span className="door-label">{t('card.howMany')}</span>
            <Stepper
              value={count}
              min={1}
              max={g.remaining}
              onChange={setCount}
              label={t('card.howMany')}
            />
            <button
              type="button"
              className="door-admit-btn"
              disabled={busy}
              onClick={() => onAdmit(count)}
              autoFocus
            >
              <Icon name="check" />
              {t('card.admit', { people: t('peopleOf', { count }) })}
            </button>
          </div>
        )}

        {g.canConfirm && (
          <div className="door-subform">
            <h3>{t('confirm.title')}</h3>
            {g.allowedCompanions > 0 && (
              <>
                <span className="door-label">
                  {t('confirm.companions', { max: g.allowedCompanions })}
                </span>
                <Stepper
                  value={companions}
                  min={0}
                  max={g.allowedCompanions}
                  onChange={setCompanions}
                  label={t('confirm.companions', { max: g.allowedCompanions })}
                />
              </>
            )}
            <button
              type="button"
              className={buttonClass('primary', undefined, true)}
              disabled={busy}
              onClick={() => onConfirm(companions)}
            >
              {t('confirm.submit')}
            </button>
          </div>
        )}

        {canFixCount && !correcting && (
          <button
            type="button"
            className={`${buttonClass('link')} door-fix`}
            onClick={() => setCorrecting(true)}
          >
            <Icon name="edit" />
            {t('correct.open')}
          </button>
        )}
        {canFixCount && correcting && (
          <form
            className="door-subform"
            onSubmit={(e) => {
              e.preventDefault();
              if (delta !== 0 && reason.trim()) onCorrect(delta, reason.trim());
            }}
          >
            <h3>{t('correct.title')}</h3>
            <span className="door-label">{t('correct.change')}</span>
            <Stepper
              value={delta}
              min={deltaMin}
              max={deltaMax}
              onChange={(n) => {
                // A correction is never zero: step over it, if there is room on the other side.
                const next = n === 0 ? (n > delta ? 1 : -1) : n;
                if (next >= deltaMin && next <= deltaMax) setDelta(next);
              }}
              label={t('correct.change')}
              signed
            />
            <p className="door-sub">{t('correct.result', { count: g.checkedIn + delta })}</p>
            <div className="field">
              <label htmlFor="fix-reason">{t('correct.reason')}</label>
              <input
                id="fix-reason"
                value={reason}
                maxLength={300}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t('correct.reasonHint')}
                required
              />
            </div>
            <button
              type="submit"
              className={buttonClass('secondary', undefined, true)}
              disabled={busy || delta === 0 || !reason.trim()}
            >
              {t('correct.submit')}
            </button>
          </form>
        )}
      </section>
    </div>
  );
}

function Search({
  actions,
  onPick,
  onOffline,
  onFail,
}: {
  actions: DoorActions;
  onPick: (guestId: string) => void;
  onOffline: () => void;
  onFail: (code: string) => void;
}) {
  const t = useTranslations('door');
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<DoorSearchRow[] | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setRows(null);
      return;
    }
    const mine = ++seq.current;
    const id = setTimeout(async () => {
      try {
        const res = await actions.search(q);
        if (mine !== seq.current) return;
        setRows(res.ok ? res.data : []);
        if (!res.ok) onFail(res.error);
      } catch {
        onOffline();
      }
    }, 250);
    return () => clearTimeout(id);
  }, [actions, onFail, onOffline, query]);

  return (
    <div className="door-search">
      <div className="field">
        <label htmlFor="door-q">{t('search.label')}</label>
        <input
          id="door-q"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
          autoFocus
        />
        <p className="field-hint">{t('search.hint')}</p>
      </div>
      {rows && rows.length === 0 && <p className="door-empty">{t('search.empty')}</p>}
      {rows && rows.length > 0 && (
        <ul className="door-results" aria-label={t('search.resultsLabel')}>
          {rows.map((r) => (
            <li key={r.guestId}>
              <button type="button" onClick={() => onPick(r.guestId)}>
                <span className="grow">
                  <strong>{r.name}</strong>
                  <span className="door-sub">
                    <Who group={r.group} phone={r.maskedPhone} />
                  </span>
                </span>
                <span
                  className={`door-pill is-${r.guestStatus === 'cancelled' ? 'muted' : r.attendance}`}
                >
                  {r.guestStatus === 'cancelled'
                    ? t('card.cancelled')
                    : r.rsvpStatus !== 'confirmed'
                      ? t(`card.${r.rsvpStatus}`)
                      : `${r.checkedIn}/${r.expected}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type WalkInInput = Parameters<DoorActions['walkIn']>[0];

function WalkIn({
  disabled,
  submit,
  openGuest,
}: {
  disabled: boolean;
  submit: (input: WalkInInput, onDuplicate: (d: DoorDuplicate[] | null) => void) => Promise<void>;
  openGuest: (guestId: string) => void;
}) {
  const t = useTranslations('door');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [party, setParty] = useState(1);
  const [duplicates, setDuplicates] = useState<DoorDuplicate[] | null>(null);
  // One key per walk-in: kept across a duplicate warning and retries, renewed after success.
  const key = useRef(newKey());

  const send = (allowDuplicate: boolean) =>
    submit(
      { fullName: name, phone, partySize: party, allowDuplicate, idempotencyKey: key.current },
      (d) => {
        setDuplicates(d);
        if (d === null) {
          key.current = newKey();
          setName('');
          setPhone('');
          setParty(1);
        }
      },
    );

  return (
    <form
      className="door-walkin"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void send(false);
      }}
    >
      <h2 className="t-card">{t('walkIn.title')}</h2>
      <p className="field-hint">{t('walkIn.hint')}</p>
      <div className="field">
        <label htmlFor="wi-name">{t('walkIn.name')}</label>
        <input
          id="wi-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
        />
      </div>
      <div className="field">
        <label htmlFor="wi-phone">{t('walkIn.phone')}</label>
        <input
          id="wi-phone"
          type="tel"
          dir="ltr"
          inputMode="tel"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value);
            setDuplicates(null);
          }}
        />
      </div>
      <span className="door-label">{t('walkIn.party')}</span>
      <Stepper value={party} min={1} max={21} onChange={setParty} label={t('walkIn.party')} />

      {duplicates && (
        <div className="door-dupes" role="alert">
          <strong>{t('walkIn.duplicateTitle')}</strong>
          <p>{t('walkIn.duplicateBody')}</p>
          <ul>
            {duplicates.map((d) => (
              <li key={d.guestId}>
                <span className="grow">
                  {d.name}
                  <span className="door-sub">
                    <Who group={d.group} phone={d.maskedPhone} />
                  </span>
                </span>
                <button
                  type="button"
                  className={buttonClass('secondary', 'sm')}
                  onClick={() => openGuest(d.guestId)}
                >
                  {t('walkIn.open')}
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={buttonClass('ghost', 'sm')}
            disabled={disabled}
            onClick={() => void send(true)}
          >
            {t('walkIn.anyway')}
          </button>
        </div>
      )}

      {!duplicates && (
        <button type="submit" className="door-admit-btn" disabled={disabled || !name.trim()}>
          <Icon name="plus" />
          {t('walkIn.submit')}
        </button>
      )}
    </form>
  );
}

/**
 * A supervisor's view of the door team: who is signed in, and a way to re-send a colleague's
 * link (to switch phones) or stop their access. The new link is shown once, to share.
 */
function Team({
  actions,
  isStaff,
  onFail,
  onOffline,
}: {
  actions: DoorActions;
  /** A supervisor on a device manages plain staff only; the owner manages everyone. */
  isStaff: boolean;
  onFail: (code: string) => void;
  onOffline: () => void;
}) {
  const t = useTranslations('door.team');
  const [team, setTeam] = useState<DoorTeamMember[] | null>(null);
  const [asking, setAsking] = useState<{ id: string; op: 'resend' | 'revoke' } | null>(null);
  const [link, setLink] = useState<{ url: string; waUrl: string | null; name: string } | null>(
    null,
  );
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await actions.team();
      if (res.ok) setTeam(res.data);
      else onFail(res.error);
    } catch {
      onOffline();
    }
  }, [actions, onFail, onOffline]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (id: string, op: 'resend' | 'revoke') => {
    setPending(true);
    setAsking(null);
    try {
      if (op === 'resend') {
        const res = await actions.resend(id);
        if (res.ok) setLink(res.data);
        else onFail(res.error);
      } else {
        const res = await actions.revoke(id);
        if (!res.ok) onFail(res.error);
      }
      await load();
    } catch {
      onOffline();
    } finally {
      setPending(false);
    }
  };

  if (!team) return null;
  return (
    <div className="door-team">
      <p className="field-hint">{t('hint')}</p>
      {link && (
        <div className="door-team-link" role="status">
          <strong>{t('linkReady', { name: link.name })}</strong>
          <code dir="ltr">{link.url}</code>
          <div className="row-tight">
            {link.waUrl && (
              <a
                href={link.waUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('primary', 'sm')}
              >
                <Icon name="chat" />
                {t('whatsapp')}
              </a>
            )}
            <button
              type="button"
              className={buttonClass('ghost', 'sm')}
              onClick={() => setLink(null)}
            >
              {t('done')}
            </button>
          </div>
        </div>
      )}
      <ul className="door-team-list">
        {team.map((m) => (
          <li key={m.membershipId}>
            <div className="grow">
              <strong>
                {m.displayName}
                {m.isSupervisor && <span className="tag tag-accent">{t('supervisor')}</span>}
              </strong>
              <span className="door-sub">
                {m.devices > 0
                  ? t('devices', { count: m.devices })
                  : m.linkPending
                    ? t('pending')
                    : t('none')}
              </span>
            </div>
            {asking?.id === m.membershipId ? (
              <div className="row-tight">
                <button
                  type="button"
                  className={buttonClass(asking.op === 'revoke' ? 'danger' : 'primary', 'sm')}
                  disabled={pending}
                  onClick={() => void run(m.membershipId, asking.op)}
                >
                  {t(asking.op === 'revoke' ? 'confirmRevoke' : 'confirmResend')}
                </button>
                <button
                  type="button"
                  className={buttonClass('ghost', 'sm')}
                  onClick={() => setAsking(null)}
                >
                  {t('back')}
                </button>
              </div>
            ) : (
              !m.self &&
              !(isStaff && m.isSupervisor) && (
                <div className="row-tight">
                  <button
                    type="button"
                    className={buttonClass('secondary', 'sm')}
                    disabled={pending}
                    onClick={() => setAsking({ id: m.membershipId, op: 'resend' })}
                  >
                    {t('resend')}
                  </button>
                  {(m.devices > 0 || m.linkPending) && (
                    <button
                      type="button"
                      className={buttonClass('ghost', 'sm')}
                      disabled={pending}
                      onClick={() => setAsking({ id: m.membershipId, op: 'revoke' })}
                    >
                      {t('revoke')}
                    </button>
                  )}
                </div>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
