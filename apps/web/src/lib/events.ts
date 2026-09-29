import 'server-only';
import { getEventView, isDomainError, type TransitionAction } from '@gp/core';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import type { IconName } from '@/components/icons';
import { getCoreContext } from './server';
import { requirePrincipal } from './session';

/**
 * Loads the event for the signed-in user, or renders 404 when they have no access to it.
 * Cached per request, so the workspace layout and its page share one load.
 */
export const loadEventView = cache(async (eventId: string) => {
  const principal = await requirePrincipal();
  try {
    return { principal, view: await getEventView(getCoreContext(), principal.user.id, eventId) };
  } catch (err) {
    if (isDomainError(err, 'not_found') || isDomainError(err, 'forbidden')) notFound();
    throw err;
  }
});

/** The forward step for each state. At most one is ever allowed, and it leads the page. */
const FORWARD: TransitionAction[] = ['activate', 'start', 'complete'];

export const ACTION_ICON: Record<TransitionAction, IconName> = {
  activate: 'rocket',
  start: 'play',
  complete: 'stop',
  cancel: 'ban',
  archive: 'archive',
  reopen: 'refresh',
};

/** Splits the state machine's allowed actions into primary, secondary and destructive. */
export function groupActions(allowed: TransitionAction[]) {
  return {
    primary: allowed.find((a) => FORWARD.includes(a)) ?? null,
    secondary: allowed.filter((a) => !FORWARD.includes(a) && a !== 'cancel'),
    canCancel: allowed.includes('cancel'),
  };
}

/** Event workspace areas. Check-in and Reports come in later phases. */
export const WORKSPACE_AREAS = [
  { key: 'overview', path: '', icon: 'grid', ready: true },
  { key: 'guests', path: '/guests', icon: 'users', ready: true },
  { key: 'invitation', path: '/invitation', icon: 'envelope', ready: true },
  { key: 'messages', path: '/messages', icon: 'chat', ready: true },
  { key: 'checkin', path: '/checkin', icon: 'scan', ready: true },
  { key: 'reports', path: '/reports', icon: 'chart', ready: false },
  { key: 'settings', path: '/settings', icon: 'settings', ready: true },
] as const satisfies readonly { key: string; path: string; icon: IconName; ready: boolean }[];

export type WorkspaceArea = (typeof WORKSPACE_AREAS)[number]['key'];
