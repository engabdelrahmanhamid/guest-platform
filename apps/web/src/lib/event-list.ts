import type { listOwnedEvents } from '@gp/core';

export type EventSummary = Awaited<ReturnType<typeof listOwnedEvents>>[number];

/** Filters on the events page. "Upcoming" is an activated event that hasn't started. */
export const EVENT_FILTERS = [
  'all',
  'draft',
  'upcoming',
  'live',
  'completed',
  'cancelled',
  'archived',
] as const;
export type EventFilter = (typeof EVENT_FILTERS)[number];

export function parseEventFilter(raw: string | undefined): EventFilter {
  return (EVENT_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as EventFilter) : 'all';
}

export function inFilter(status: string, filter: EventFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'upcoming') return status === 'active';
  return status === filter;
}

/** Live first, then drafts and upcoming events soonest first, then the rest most recent first. */
const RANK: Record<string, number> = { live: 0, active: 1, draft: 1 };
export function byRelevance(a: EventSummary, b: EventSummary): number {
  const ra = RANK[a.status] ?? 2;
  const rb = RANK[b.status] ?? 2;
  if (ra !== rb) return ra - rb;
  const diff = a.startsAt.getTime() - b.startsAt.getTime();
  return ra === 2 ? -diff : diff;
}

/** The event worth putting first on the dashboard: live now, else the next upcoming one. */
export function featuredEvent(events: EventSummary[]): EventSummary | null {
  const open = events.filter((e) => !e.disabledAt);
  return (
    open.find((e) => e.status === 'live') ??
    open
      .filter((e) => e.status === 'active' || e.status === 'draft')
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0] ??
    null
  );
}
