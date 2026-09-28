import { describe, expect, it } from 'vitest';
import {
  allowedTransitions,
  checkTransition,
  type EventStatus,
  type LifecycleEvent,
  lifecycleTimes,
  scheduledTransition,
  TRANSITION_ACTIONS,
} from './lifecycle';

const start = new Date('2030-03-01T17:00:00Z');
function ev(status: EventStatus, extra: Partial<LifecycleEvent> = {}): LifecycleEvent {
  return {
    status,
    startsAt: start,
    endsAt: null,
    completedAt: null,
    reopenedAt: null,
    disabledAt: null,
    autoOpenCheckin: true,
    checkinOpensOffsetMin: -180,
    assumedDurationMin: 360,
    autoCloseCheckin: true,
    checkinClosesOffsetMin: 360,
    reopenWindowMin: 2880,
    ...extra,
  };
}
const now = new Date('2030-02-01T00:00:00Z');

describe('event state machine', () => {
  it.each([
    ['draft', ['activate']],
    ['active', ['start', 'cancel']],
    ['live', ['complete', 'cancel']],
    ['cancelled', ['archive']],
    ['archived', []],
  ] as const)('%s allows exactly %j', (status, expected) => {
    expect(allowedTransitions(ev(status), now)).toEqual(expected);
  });

  it('completed allows archive and reopen inside the window only', () => {
    const completedAt = new Date('2030-03-02T05:00:00Z');
    const e = ev('completed', { completedAt });
    expect(allowedTransitions(e, new Date(completedAt.getTime() + 60_000))).toEqual([
      'archive',
      'reopen',
    ]);
    const late = new Date(completedAt.getTime() + 2881 * 60_000);
    expect(checkTransition(e, 'reopen', late)).toEqual({ ok: false, code: 'reopen_window_passed' });
  });

  it.each([
    ['archived', 'start'],
    ['cancelled', 'activate'],
    ['draft', 'complete'],
    ['draft', 'cancel'],
    ['completed', 'cancel'],
    ['archived', 'reopen'],
  ] as const)('rejects %s → %s', (status, action) => {
    expect(checkTransition(ev(status), action, now)).toEqual({
      ok: false,
      code: 'invalid_transition',
    });
  });

  it('blocks every transition on a disabled event', () => {
    for (const action of TRANSITION_ACTIONS) {
      expect(checkTransition(ev('active', { disabledAt: now }), action, now).ok).toBe(false);
    }
  });
});

describe('lifecycle times', () => {
  it('derives open, end and close from the stored offsets', () => {
    const t = lifecycleTimes(ev('active'));
    expect(t.checkinOpensAt.toISOString()).toBe('2030-03-01T14:00:00.000Z');
    expect(t.effectiveEnd.toISOString()).toBe('2030-03-01T23:00:00.000Z');
    expect(t.checkinClosesAt.toISOString()).toBe('2030-03-02T05:00:00.000Z');
    expect(t.reopenUntil).toBeNull();
  });

  it('uses the explicit end time when set', () => {
    const t = lifecycleTimes(ev('active', { endsAt: new Date('2030-03-01T20:00:00Z') }));
    expect(t.checkinClosesAt.toISOString()).toBe('2030-03-02T02:00:00.000Z');
  });
});

describe('scheduled transitions', () => {
  it('opens at the configured time and closes after the close offset', () => {
    expect(scheduledTransition(ev('active'), new Date('2030-03-01T13:59:00Z'))).toBeNull();
    expect(scheduledTransition(ev('active'), new Date('2030-03-01T14:00:00Z'))).toBe('start');
    expect(scheduledTransition(ev('live'), new Date('2030-03-02T04:59:00Z'))).toBeNull();
    expect(scheduledTransition(ev('live'), new Date('2030-03-02T05:00:00Z'))).toBe('complete');
  });

  it('respects auto-open/close switches, reopen and disable', () => {
    const late = new Date('2030-03-05T00:00:00Z');
    expect(scheduledTransition(ev('active', { autoOpenCheckin: false }), late)).toBeNull();
    expect(scheduledTransition(ev('live', { autoCloseCheckin: false }), late)).toBeNull();
    expect(scheduledTransition(ev('live', { reopenedAt: late }), late)).toBeNull();
    expect(scheduledTransition(ev('active', { disabledAt: late }), late)).toBeNull();
    expect(scheduledTransition(ev('draft'), late)).toBeNull();
  });
});
