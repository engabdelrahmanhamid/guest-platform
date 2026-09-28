import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { workspaceKind, workspaceRole } from './enums';
import { users } from './identity';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const workspaces = pgTable(
  'workspaces',
  {
    id: uuid('id').primaryKey(),
    kind: workspaceKind('kind').notNull(),
    name: text('name').notNull(),
    retentionGuestPiiDays: integer('retention_guest_pii_days'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    // One personal workspace per user.
    uniqueIndex('workspaces_one_personal_per_user')
      .on(t.createdByUserId)
      .where(sql`${t.kind} = 'personal'`),
    check(
      'workspaces_retention_positive',
      sql`${t.retentionGuestPiiDays} IS NULL OR ${t.retentionGuestPiiDays} > 0`,
    ),
  ],
);

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    role: workspaceRole('role').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ name: 'workspace_members_pkey', columns: [t.workspaceId, t.userId] })],
);
