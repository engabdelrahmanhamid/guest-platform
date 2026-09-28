import { bigserial, index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { actorType } from './enums';
import { eventMemberships, events } from './events';
import { users } from './identity';
import { workspaces } from './workspaces';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const platformSettings = pgTable('platform_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedByUserId: uuid('updated_by_user_id').references(() => users.id),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

/** Append-only timeline and domain-event log (update/delete blocked by trigger). */
export const activity = pgTable(
  'activity',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: uuid('event_id').references(() => events.id),
    workspaceId: uuid('workspace_id').references(() => workspaces.id),
    guestId: uuid('guest_id'),
    type: text('type').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorMembershipId: uuid('actor_membership_id').references(() => eventMemberships.id),
    actorUserId: uuid('actor_user_id').references(() => users.id),
    data: jsonb('data').notNull().default({}),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('activity_event_idx').on(t.eventId, t.id),
    index('activity_event_guest_idx').on(t.eventId, t.guestId, t.id),
  ],
);

/** Every platform-admin action (update/delete blocked by trigger). */
export const adminAuditLog = pgTable(
  'admin_audit_log',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    adminUserId: uuid('admin_user_id')
      .notNull()
      .references(() => users.id),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    reason: text('reason'),
    before: jsonb('before'),
    after: jsonb('after'),
    userAgent: text('user_agent'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('admin_audit_target_idx').on(t.targetType, t.targetId)],
);
