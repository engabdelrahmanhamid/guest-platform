import { eventMemberships, events, workspaceMembers } from '@gp/db/schema';
import { and, eq, ne } from 'drizzle-orm';
import type { Actor } from '../activity/activity';
import type { Principal } from '../identity/auth';
import type { DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';

/**
 * Server-side authorization. Every event-scoped check goes through `requireEventAccess`, which
 * resolves the caller's membership on the event; a caller with no membership gets `not_found`
 * (not `forbidden`), so other workspaces' event ids can't be probed.
 */
export const EVENT_CAPABILITIES = [
  'event.view',
  'event.edit',
  'event.transition',
  'members.view',
  'members.manage',
  'activity.view',
] as const;
export type EventCapability = (typeof EVENT_CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<'owner' | 'staff', ReadonlySet<EventCapability>> = {
  owner: new Set(EVENT_CAPABILITIES),
  // Staff operate check-in from phase 4; they hold no owner capability.
  staff: new Set<EventCapability>(['event.view']),
};

export function roleCan(role: 'owner' | 'staff', capability: EventCapability): boolean {
  return ROLE_CAPABILITIES[role].has(capability);
}

export type EventRow = typeof events.$inferSelect;

export interface EventAccess {
  event: EventRow;
  membership: { id: string; role: 'owner' | 'staff'; isSupervisor: boolean };
  actor: Extract<Actor, { type: 'member' }>;
}

/**
 * Loads the event with the caller's membership and checks `capability`.
 * Pass `forUpdate` inside a transaction to lock the event row for the rest of it.
 */
export async function requireEventAccess(
  db: DbOrTx,
  userId: string,
  eventId: string,
  capability: EventCapability,
  opts: { forUpdate?: boolean } = {},
): Promise<EventAccess> {
  const base = db
    .select({ event: events, membership: eventMemberships })
    .from(events)
    .innerJoin(
      eventMemberships,
      and(
        eq(eventMemberships.eventId, events.id),
        eq(eventMemberships.userId, userId),
        ne(eventMemberships.status, 'removed'),
      ),
    )
    .where(eq(events.id, eventId));
  const [row] = await (opts.forUpdate ? base.for('update', { of: events }) : base);
  if (!row) throw new DomainError('not_found');

  const { membership } = row;
  // Owners must also still own the workspace the event belongs to.
  if (membership.role === 'owner') {
    const [ws] = await db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, row.event.workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      );
    if (ws?.role !== 'owner') throw new DomainError('not_found');
  }
  if (!roleCan(membership.role, capability)) throw new DomainError('forbidden');

  return {
    event: row.event,
    membership: { id: membership.id, role: membership.role, isSupervisor: membership.isSupervisor },
    actor: { type: 'member', membershipId: membership.id, userId },
  };
}

/**
 * Platform admin operations need the admin role, TOTP enrolled and a session that passed the
 * second factor. Returns `mfa_required` when only the second factor is missing.
 */
export function requireAdmin(principal: Principal | null): Principal {
  if (!principal) throw new DomainError('unauthenticated');
  if (principal.user.platformRole !== 'admin') throw new DomainError('forbidden');
  if (!principal.user.totpEnabled || !principal.session.mfaVerified) {
    throw new DomainError('mfa_required');
  }
  return principal;
}

export function requirePrincipal(principal: Principal | null): Principal {
  if (!principal) throw new DomainError('unauthenticated');
  return principal;
}
