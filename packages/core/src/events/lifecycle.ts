/**
 * The event state machine. Pure functions only, so the same rules drive the domain services,
 * the scheduler and which buttons the UI shows. A database trigger enforces the same edges.
 *
 *   draft ──activate──▶ active ──start──▶ live ──complete──▶ completed ──archive──▶ archived
 *                         │                 │                  ▲   │
 *                         └──cancel──┐      └──cancel──┐       │   └─reopen (within window)─▶ live
 *                                    ▼                 ▼       │
 *                                 cancelled ◀──────────┘    cancelled ──archive──▶ archived
 */
export const EVENT_STATUSES = [
  'draft',
  'active',
  'live',
  'completed',
  'cancelled',
  'archived',
] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const TRANSITIONS = {
  activate: { from: ['draft'], to: 'active', activity: 'event.activated' },
  start: { from: ['active'], to: 'live', activity: 'event.started' },
  complete: { from: ['live'], to: 'completed', activity: 'event.completed' },
  cancel: { from: ['active', 'live'], to: 'cancelled', activity: 'event.cancelled' },
  archive: { from: ['completed', 'cancelled'], to: 'archived', activity: 'event.archived' },
  reopen: { from: ['completed'], to: 'live', activity: 'event.reopened' },
} as const satisfies Record<
  string,
  { from: readonly EventStatus[]; to: EventStatus; activity: string }
>;

export type TransitionAction = keyof typeof TRANSITIONS;
export const TRANSITION_ACTIONS = Object.keys(TRANSITIONS) as TransitionAction[];

/** Statuses in which the owner may edit details and manage staff. */
export const EDITABLE_STATUSES: readonly EventStatus[] = ['draft', 'active', 'live'];

export interface LifecycleConfig {
  autoOpenCheckin: boolean;
  checkinOpensOffsetMin: number;
  assumedDurationMin: number;
  autoCloseCheckin: boolean;
  checkinClosesOffsetMin: number;
  reopenWindowMin: number;
}

export interface LifecycleEvent extends LifecycleConfig {
  status: EventStatus;
  startsAt: Date;
  endsAt: Date | null;
  completedAt: Date | null;
  reopenedAt: Date | null;
  disabledAt: Date | null;
}

const MINUTE = 60_000;

/** Derived times. Stored configuration never duplicates them, so edits can't leave them stale. */
export function lifecycleTimes(e: Omit<LifecycleEvent, 'status' | 'disabledAt'>) {
  const effectiveEnd = e.endsAt ?? new Date(e.startsAt.getTime() + e.assumedDurationMin * MINUTE);
  return {
    checkinOpensAt: new Date(e.startsAt.getTime() + e.checkinOpensOffsetMin * MINUTE),
    effectiveEnd,
    checkinClosesAt: new Date(effectiveEnd.getTime() + e.checkinClosesOffsetMin * MINUTE),
    reopenUntil: e.completedAt
      ? new Date(e.completedAt.getTime() + e.reopenWindowMin * MINUTE)
      : null,
  };
}

export type TransitionCheck =
  | { ok: true }
  | { ok: false; code: 'invalid_transition' | 'reopen_window_passed' | 'event_disabled' };

/** Whether `action` is allowed on the event right now (ignoring who is asking). */
export function checkTransition(
  e: LifecycleEvent,
  action: TransitionAction,
  now: Date,
): TransitionCheck {
  if (e.disabledAt) return { ok: false, code: 'event_disabled' };
  const rule = TRANSITIONS[action];
  if (!(rule.from as readonly EventStatus[]).includes(e.status)) {
    return { ok: false, code: 'invalid_transition' };
  }
  if (action === 'reopen') {
    const { reopenUntil } = lifecycleTimes(e);
    if (!reopenUntil || now.getTime() > reopenUntil.getTime()) {
      return { ok: false, code: 'reopen_window_passed' };
    }
  }
  return { ok: true };
}

export function allowedTransitions(e: LifecycleEvent, now: Date): TransitionAction[] {
  return TRANSITION_ACTIONS.filter((a) => checkTransition(e, a, now).ok);
}

export function isEditable(e: Pick<LifecycleEvent, 'status' | 'disabledAt'>): boolean {
  return !e.disabledAt && EDITABLE_STATUSES.includes(e.status);
}

/** What the scheduler should do to this event at `now`, if anything. */
export function scheduledTransition(e: LifecycleEvent, now: Date): 'start' | 'complete' | null {
  if (e.disabledAt) return null;
  const t = lifecycleTimes(e);
  if (e.status === 'active' && e.autoOpenCheckin && now >= t.checkinOpensAt) return 'start';
  if (
    e.status === 'live' &&
    e.autoCloseCheckin &&
    e.reopenedAt === null &&
    now >= t.checkinClosesAt
  ) {
    return 'complete';
  }
  return null;
}
