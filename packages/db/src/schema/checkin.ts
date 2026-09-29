import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { checkInAction, checkInMethod, staffSessionEndReason } from './enums';
import { eventMemberships, events } from './events';
import { guests } from './guests';
import { bytea } from './identity';
import { guestPasses } from './lifecycle';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * One-time access links for staff. The token (128 random bits) exists only in the link; the
 * database keeps its SHA-256. A link works once, on the device that taps Continue, while the
 * event is active or live. At most one open link per staff member.
 */
export const staffAccessLinks = pgTable(
  'staff_access_links',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').notNull(),
    tokenHash: bytea('token_hash').notNull(),
    createdByMembershipId: uuid('created_by_membership_id')
      .notNull()
      .references(() => eventMemberships.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    redeemedAt: ts('redeemed_at'),
    revokedAt: ts('revoked_at'),
  },
  (t) => [
    foreignKey({
      name: 'staff_access_links_membership_fk',
      columns: [t.eventId, t.membershipId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.id],
    }),
    unique('staff_access_links_token_hash').on(t.tokenHash),
    uniqueIndex('staff_access_links_one_open')
      .on(t.membershipId)
      .where(sql`${t.redeemedAt} IS NULL AND ${t.revokedAt} IS NULL`),
    check('staff_access_links_token_hash_len', sql`octet_length(${t.tokenHash}) = 32`),
    check(
      'staff_access_links_used_once',
      sql`${t.redeemedAt} IS NULL OR ${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.redeemedAt}`,
    ),
  ],
);

/**
 * A signed-in staff device, created when a link is redeemed. The cookie holds 256 random bits;
 * the database keeps its SHA-256. A session works while the event is active or live, the
 * membership isn't removed and the session isn't ended, re-checked on every request.
 */
export const staffSessions = pgTable(
  'staff_sessions',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    membershipId: uuid('membership_id').notNull(),
    linkId: uuid('link_id')
      .notNull()
      .references(() => staffAccessLinks.id),
    tokenHash: bytea('token_hash').notNull(),
    deviceLabel: text('device_label'),
    createdAt: ts('created_at').notNull().defaultNow(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    endedAt: ts('ended_at'),
    endReason: staffSessionEndReason('end_reason'),
    endedByMembershipId: uuid('ended_by_membership_id').references(() => eventMemberships.id),
  },
  (t) => [
    foreignKey({
      name: 'staff_sessions_membership_fk',
      columns: [t.eventId, t.membershipId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.id],
    }),
    unique('staff_sessions_token_hash').on(t.tokenHash),
    unique('staff_sessions_link_once').on(t.linkId),
    index('staff_sessions_membership_idx').on(t.membershipId),
    check('staff_sessions_token_hash_len', sql`octet_length(${t.tokenHash}) = 32`),
    check(
      'staff_sessions_ended_consistent',
      sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`,
    ),
    check(
      'staff_sessions_device_label_len',
      sql`${t.deviceLabel} IS NULL OR char_length(${t.deviceLabel}) <= 80`,
    ),
  ],
);

/**
 * How many of each guest's party are inside: a projection of the ledger, written only by the
 * ledger's insert trigger in the same transaction. Status (not arrived / partial / complete) is
 * derived against the expected party size, never stored.
 */
export const attendance = pgTable(
  'attendance',
  {
    guestId: uuid('guest_id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    checkedInCount: smallint('checked_in_count').notNull(),
    firstCheckInAt: ts('first_check_in_at'),
    lastCheckInAt: ts('last_check_in_at'),
    updatedAt: ts('updated_at').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'attendance_guest_fk',
      columns: [t.eventId, t.guestId],
      foreignColumns: [guests.eventId, guests.id],
    }),
    index('attendance_event_idx').on(t.eventId),
    check('attendance_count_range', sql`${t.checkedInCount} BETWEEN 0 AND 21`),
  ],
);

/**
 * The append-only check-in ledger and the source of truth for attendance. Each row records who
 * (membership and device), how, how many, the count after it, and the client's idempotency key.
 */
export const checkInLogs = pgTable(
  'check_in_logs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    eventId: uuid('event_id').notNull(),
    guestId: uuid('guest_id').notNull(),
    action: checkInAction('action').notNull(),
    method: checkInMethod('method').notNull(),
    countDelta: smallint('count_delta').notNull(),
    resultingCount: smallint('resulting_count').notNull(),
    reason: text('reason'),
    passId: uuid('pass_id'),
    actorMembershipId: uuid('actor_membership_id').notNull(),
    staffSessionId: uuid('staff_session_id').references(() => staffSessions.id),
    idempotencyKey: uuid('idempotency_key').notNull(),
    createdAt: ts('created_at').notNull(),
  },
  (t) => [
    foreignKey({
      name: 'check_in_logs_guest_fk',
      columns: [t.eventId, t.guestId],
      foreignColumns: [guests.eventId, guests.id],
    }),
    foreignKey({
      name: 'check_in_logs_pass_fk',
      columns: [t.guestId, t.passId],
      foreignColumns: [guestPasses.guestId, guestPasses.id],
    }),
    foreignKey({
      name: 'check_in_logs_actor_fk',
      columns: [t.eventId, t.actorMembershipId],
      foreignColumns: [eventMemberships.eventId, eventMemberships.id],
    }),
    unique('check_in_logs_idempotency_key').on(t.idempotencyKey),
    index('check_in_logs_event_idx').on(t.eventId, t.id),
    index('check_in_logs_guest_idx').on(t.guestId, t.id),
    check('check_in_logs_delta_nonzero', sql`${t.countDelta} <> 0`),
    check('check_in_logs_resulting_range', sql`${t.resultingCount} BETWEEN 0 AND 21`),
    check(
      'check_in_logs_only_corrections_subtract',
      sql`${t.countDelta} > 0 OR ${t.action} = 'correction'`,
    ),
    check(
      'check_in_logs_correction_reason',
      sql`(${t.action} = 'correction') = (${t.reason} IS NOT NULL)`,
    ),
    check(
      'check_in_logs_reason_len',
      sql`${t.reason} IS NULL OR char_length(${t.reason}) BETWEEN 1 AND 300`,
    ),
    check(
      'check_in_logs_method_matches',
      sql`(${t.method} = 'qr') = (${t.passId} IS NOT NULL)
       AND (${t.action} = 'walk_in') = (${t.method} = 'walk_in')`,
    ),
  ],
);
