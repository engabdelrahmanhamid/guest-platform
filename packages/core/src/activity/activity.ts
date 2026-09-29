import { activity } from '@gp/db/schema';
import { and, desc, eq } from 'drizzle-orm';
import type { DbOrTx } from '../shared/context';

/** The fixed list of activity types. Adding one is a code change, reviewed like any other. */
export const ACTIVITY_TYPES = [
  'user.registered',
  'workspace.created',
  'event.created',
  'event.updated',
  'event.activated',
  'event.started',
  'event.completed',
  'event.cancelled',
  'event.archived',
  'event.reopened',
  'event_member.added',
  'event_member.removed',
  'event_member.supervisor_enabled',
  'event_member.supervisor_disabled',
  'platform_setting.updated',
  'guest.created',
  'guest.updated',
  'guest.cancelled',
  'guest.restored',
  'guest.deleted',
  'guest.group_changed',
  'guest.companion_allowance_changed',
  'guest_group.created',
  'guest_group.renamed',
  'guest_group.deleted',
  'guest_import.created',
  'guest_import.parsed',
  'guest_import.committed',
  'guest_import.failed',
  'guest_import.discarded',
  'invitation.created',
  'invitation.shared',
  'invitation.opened',
  'invitation.token_rotated',
  'invitation.links_exported',
  'invitation.design_updated',
  'invitation.share_text_updated',
  'rsvp.confirmed',
  'rsvp.declined',
  'rsvp.changed',
  'pass.issued',
  'pass.revoked',
  'pass.replaced',
  'attendance.checked_in',
  'attendance.corrected',
  'attendance.walk_in',
  'staff.access_sent',
  'staff.access_revoked',
  'staff.device_joined',
  'staff.signed_out',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Who performed an action. Event-scoped actions by people are always a membership. */
export type Actor =
  | { type: 'member'; membershipId: string; userId: string | null }
  | { type: 'user'; userId: string }
  | { type: 'admin'; userId: string }
  /** The guest, acting through their invitation link. */
  | { type: 'guest' }
  | { type: 'system' };

export interface ActivityInput {
  type: ActivityType;
  actor: Actor;
  eventId?: string;
  workspaceId?: string;
  guestId?: string;
  data?: Record<string, unknown>;
}

function activityRow(input: ActivityInput) {
  const { actor } = input;
  return {
    type: input.type,
    eventId: input.eventId ?? null,
    workspaceId: input.workspaceId ?? null,
    guestId: input.guestId ?? null,
    actorType: actor.type,
    actorMembershipId: actor.type === 'member' ? actor.membershipId : null,
    actorUserId: actor.type === 'system' || actor.type === 'guest' ? null : actor.userId,
    data: input.data ?? {},
  };
}

/** Appends an activity row. Call inside the same transaction as the change it describes. */
export async function recordActivity(db: DbOrTx, input: ActivityInput): Promise<void> {
  await db.insert(activity).values(activityRow(input));
}

/** Appends many rows in one statement (bulk actions, import commit). */
export async function recordActivities(db: DbOrTx, inputs: ActivityInput[]): Promise<void> {
  for (let i = 0; i < inputs.length; i += 1000) {
    const chunk = inputs.slice(i, i + 1000);
    if (chunk.length) await db.insert(activity).values(chunk.map(activityRow));
  }
}

export async function listEventActivity(db: DbOrTx, eventId: string, limit = 100) {
  return db
    .select()
    .from(activity)
    .where(and(eq(activity.eventId, eventId)))
    .orderBy(desc(activity.id))
    .limit(limit);
}
