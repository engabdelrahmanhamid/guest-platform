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
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Who performed an action. Event-scoped actions by people are always a membership. */
export type Actor =
  | { type: 'member'; membershipId: string; userId: string | null }
  | { type: 'user'; userId: string }
  | { type: 'admin'; userId: string }
  | { type: 'system' };

export interface ActivityInput {
  type: ActivityType;
  actor: Actor;
  eventId?: string;
  workspaceId?: string;
  data?: Record<string, unknown>;
}

/** Appends an activity row. Call inside the same transaction as the change it describes. */
export async function recordActivity(db: DbOrTx, input: ActivityInput): Promise<void> {
  const { actor } = input;
  await db.insert(activity).values({
    type: input.type,
    eventId: input.eventId ?? null,
    workspaceId: input.workspaceId ?? null,
    actorType: actor.type,
    actorMembershipId: actor.type === 'member' ? actor.membershipId : null,
    actorUserId: actor.type === 'system' ? null : actor.userId,
    data: input.data ?? {},
  });
}

export async function listEventActivity(db: DbOrTx, eventId: string, limit = 100) {
  return db
    .select()
    .from(activity)
    .where(and(eq(activity.eventId, eventId)))
    .orderBy(desc(activity.id))
    .limit(limit);
}
