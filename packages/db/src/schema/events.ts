import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { eventCategory, eventRole, eventStatus, eventType, membershipStatus } from './enums';
import { citext, users } from './identity';
import { workspaces } from './workspaces';

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id),
    category: eventCategory('category').notNull(),
    type: eventType('type').notNull(),
    name: text('name').notNull(),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    timezone: text('timezone').notNull().default('Asia/Riyadh'),
    city: text('city').notNull(),
    venueName: text('venue_name').notNull(),
    address: text('address'),
    mapsUrl: text('maps_url'),
    description: text('description'),
    coverImageKey: text('cover_image_key'),
    logoKey: text('logo_key'),
    defaultAllowedCompanions: smallint('default_allowed_companions').notNull().default(0),
    status: eventStatus('status').notNull().default('draft'),
    // Lifecycle timing: effective values stored per event, pre-filled from platform_settings.
    autoOpenCheckin: boolean('auto_open_checkin').notNull(),
    checkinOpensOffsetMin: integer('checkin_opens_offset_min').notNull(),
    assumedDurationMin: integer('assumed_duration_min').notNull(),
    autoCloseCheckin: boolean('auto_close_checkin').notNull(),
    checkinClosesOffsetMin: integer('checkin_closes_offset_min').notNull(),
    reopenWindowMin: integer('reopen_window_min').notNull(),
    publishedAt: ts('published_at'),
    liveAt: ts('live_at'),
    completedAt: ts('completed_at'),
    // Set when a completed event is reopened; the scheduler never auto-closes a reopened event.
    reopenedAt: ts('reopened_at'),
    cancelledAt: ts('cancelled_at'),
    cancellationReason: text('cancellation_reason'),
    cancelledByMembershipId: uuid('cancelled_by_membership_id').references(
      (): AnyPgColumn => eventMemberships.id,
    ),
    archivedAt: ts('archived_at'),
    disabledAt: ts('disabled_at'),
    disabledReason: text('disabled_reason'),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('events_workspace_status_idx').on(t.workspaceId, t.status),
    index('events_status_starts_idx').on(t.status, t.startsAt),
    check('events_name_len', sql`char_length(${t.name}) BETWEEN 1 AND 150`),
    check('events_city_len', sql`char_length(${t.city}) BETWEEN 1 AND 80`),
    check('events_venue_len', sql`char_length(${t.venueName}) BETWEEN 1 AND 150`),
    check('events_address_len', sql`${t.address} IS NULL OR char_length(${t.address}) <= 300`),
    check(
      'events_description_len',
      sql`${t.description} IS NULL OR char_length(${t.description}) <= 1000`,
    ),
    check(
      'events_maps_url_format',
      sql`${t.mapsUrl} IS NULL OR (${t.mapsUrl} ~ '^https?://' AND char_length(${t.mapsUrl}) <= 500)`,
    ),
    check('events_ends_after_starts', sql`${t.endsAt} IS NULL OR ${t.endsAt} > ${t.startsAt}`),
    check('events_companions_range', sql`${t.defaultAllowedCompanions} BETWEEN 0 AND 20`),
    check(
      'events_category_type',
      sql`(${t.category} = 'private' AND ${t.type} IN ('wedding','malka','engagement','graduation','birthday','private_dinner','other'))
       OR (${t.category} = 'business' AND ${t.type} IN ('conference','corporate','product_launch','opening','ceremony','exhibition','other'))`,
    ),
    check('events_opens_offset_range', sql`${t.checkinOpensOffsetMin} BETWEEN -10080 AND 0`),
    check('events_duration_range', sql`${t.assumedDurationMin} BETWEEN 30 AND 4320`),
    check('events_closes_offset_range', sql`${t.checkinClosesOffsetMin} BETWEEN 0 AND 4320`),
    check('events_reopen_window_range', sql`${t.reopenWindowMin} BETWEEN 0 AND 10080`),
    check(
      'events_published_when_not_draft',
      sql`${t.status} = 'draft' OR ${t.publishedAt} IS NOT NULL`,
    ),
    check('events_live_at_when_live', sql`${t.status} <> 'live' OR ${t.liveAt} IS NOT NULL`),
    check(
      'events_completed_at_when_completed',
      sql`${t.status} <> 'completed' OR ${t.completedAt} IS NOT NULL`,
    ),
    check(
      'events_cancellation_consistent',
      sql`(${t.cancelledAt} IS NULL) = (${t.cancellationReason} IS NULL)
       AND (${t.status} <> 'cancelled' OR ${t.cancelledAt} IS NOT NULL)`,
    ),
    check(
      'events_cancellation_reason_len',
      sql`${t.cancellationReason} IS NULL OR char_length(${t.cancellationReason}) BETWEEN 1 AND 500`,
    ),
    check(
      'events_archived_at_when_archived',
      sql`${t.status} <> 'archived' OR ${t.archivedAt} IS NOT NULL`,
    ),
    check(
      'events_disabled_consistent',
      sql`(${t.disabledAt} IS NULL) = (${t.disabledReason} IS NULL)`,
    ),
  ],
);

export const eventMemberships = pgTable(
  'event_memberships',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id),
    role: eventRole('role').notNull(),
    isSupervisor: boolean('is_supervisor').notNull().default(false),
    displayName: text('display_name').notNull(),
    phoneE164: text('phone_e164'),
    email: citext('email'),
    status: membershipStatus('status').notNull(),
    createdByMembershipId: uuid('created_by_membership_id'),
    removedByMembershipId: uuid('removed_by_membership_id'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    removedAt: ts('removed_at'),
  },
  (t) => [
    foreignKey({
      name: 'event_memberships_created_by_fk',
      columns: [t.createdByMembershipId],
      foreignColumns: [t.id],
    }),
    foreignKey({
      name: 'event_memberships_removed_by_fk',
      columns: [t.removedByMembershipId],
      foreignColumns: [t.id],
    }),
    uniqueIndex('event_memberships_one_owner')
      .on(t.eventId)
      .where(sql`${t.role} = 'owner' AND ${t.status} <> 'removed'`),
    uniqueIndex('event_memberships_user_once')
      .on(t.eventId, t.userId)
      .where(sql`${t.userId} IS NOT NULL AND ${t.status} <> 'removed'`),
    index('event_memberships_user_idx').on(t.userId),
    check('event_memberships_owner_has_user', sql`${t.role} <> 'owner' OR ${t.userId} IS NOT NULL`),
    check(
      'event_memberships_supervisor_only_staff',
      sql`NOT ${t.isSupervisor} OR ${t.role} = 'staff'`,
    ),
    check(
      'event_memberships_removed_consistent',
      sql`(${t.status} = 'removed') = (${t.removedAt} IS NOT NULL)`,
    ),
    check('event_memberships_name_len', sql`char_length(${t.displayName}) BETWEEN 1 AND 80`),
    check(
      'event_memberships_phone_format',
      sql`${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
  ],
);
