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
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  actorType,
  invitationDelivery,
  invitationTemplate,
  locale,
  messageType,
  passRevokeReason,
  passStatus,
  rsvpStatus,
} from './enums';
import { eventMemberships, events } from './events';
import { bytea } from './identity';
import { guests } from './guests';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/**
 * Public tokens (22 base62 characters, about 131 random bits) are bearer credentials and are never
 * stored in plain text: `token_hash` is their SHA-256 (unique, used for lookup) and `token_enc` is
 * the token encrypted with the app key, bound to the row (see core/shared/tokens.ts).
 */
const tokenColumns = () => ({
  tokenHash: bytea('token_hash').notNull(),
  tokenEnc: bytea('token_enc').notNull(),
});

/**
 * The guest's personal link, created with the guest (one per guest in V1). The token is the only
 * thing in the URL and can be rotated. Sharing and opening are tracked separately: a manual
 * share says the owner handed the link off, never that it was delivered.
 */
export const invitations = pgTable(
  'invitations',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    guestId: uuid('guest_id').notNull(),
    ...tokenColumns(),
    deliveryStatus: invitationDelivery('delivery_status').notNull().default('not_sent'),
    firstSharedAt: ts('first_shared_at'),
    lastSharedAt: ts('last_shared_at'),
    shareCount: integer('share_count').notNull().default(0),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    readAt: ts('read_at'),
    openedAt: ts('opened_at'),
    lastOpenedAt: ts('last_opened_at'),
    openCount: integer('open_count').notNull().default(0),
    tokenRotatedAt: ts('token_rotated_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('invitations_guest_once').on(t.guestId),
    unique('invitations_token_hash').on(t.tokenHash),
    foreignKey({
      name: 'invitations_guest_fk',
      columns: [t.eventId, t.guestId],
      foreignColumns: [guests.eventId, guests.id],
    }).onDelete('cascade'),
    index('invitations_event_idx').on(t.eventId),
    check('invitations_token_hash_len', sql`octet_length(${t.tokenHash}) = 32`),
    check('invitations_counts', sql`${t.shareCount} >= 0 AND ${t.openCount} >= 0`),
    check(
      'invitations_share_consistent',
      sql`(${t.shareCount} = 0) = (${t.firstSharedAt} IS NULL)
       AND (${t.firstSharedAt} IS NULL) = (${t.lastSharedAt} IS NULL)`,
    ),
    check(
      'invitations_open_consistent',
      sql`(${t.openCount} = 0) = (${t.openedAt} IS NULL)
       AND (${t.openedAt} IS NULL) = (${t.lastOpenedAt} IS NULL)`,
    ),
  ],
);

/** The guest's current answer, one row per guest, created with the guest as `pending`. */
export const rsvps = pgTable(
  'rsvps',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    guestId: uuid('guest_id').notNull(),
    status: rsvpStatus('status').notNull().default('pending'),
    companionCount: smallint('companion_count').notNull().default(0),
    respondedAt: ts('responded_at'),
    lastActorType: actorType('last_actor_type'),
    lastActorMembershipId: uuid('last_actor_membership_id').references(() => eventMemberships.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('rsvps_guest_once').on(t.guestId),
    foreignKey({
      name: 'rsvps_guest_fk',
      columns: [t.eventId, t.guestId],
      foreignColumns: [guests.eventId, guests.id],
    }).onDelete('cascade'),
    index('rsvps_event_status_idx').on(t.eventId, t.status),
    check('rsvps_companions_range', sql`${t.companionCount} BETWEEN 0 AND 20`),
    check(
      'rsvps_companions_only_confirmed',
      sql`${t.status} = 'confirmed' OR ${t.companionCount} = 0`,
    ),
    check(
      'rsvps_responded_consistent',
      sql`(${t.status} = 'pending') = (${t.respondedAt} IS NULL)`,
    ),
    check(
      'rsvps_actor_consistent',
      sql`(${t.status} = 'pending') = (${t.lastActorType} IS NULL)
       AND (${t.lastActorMembershipId} IS NULL OR ${t.lastActorType} = 'member')`,
    ),
  ],
);

/**
 * QR entry passes. A new row per issuance; at most one active per guest. A revoked pass never
 * becomes active again. Whether a pass is usable today is derived from the guest, the RSVP and
 * the event, so completing or cancelling an event writes nothing here.
 */
export const guestPasses = pgTable(
  'guest_passes',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id').notNull(),
    guestId: uuid('guest_id').notNull(),
    ...tokenColumns(),
    status: passStatus('status').notNull().default('active'),
    issuedAt: ts('issued_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokeReason: passRevokeReason('revoke_reason'),
    replacedByPassId: uuid('replaced_by_pass_id').references((): AnyPgColumn => guestPasses.id),
  },
  (t) => [
    unique('guest_passes_token_hash').on(t.tokenHash),
    foreignKey({
      name: 'guest_passes_guest_fk',
      columns: [t.eventId, t.guestId],
      foreignColumns: [guests.eventId, guests.id],
    }).onDelete('cascade'),
    uniqueIndex('guest_passes_one_active')
      .on(t.guestId)
      .where(sql`${t.status} = 'active'`),
    index('guest_passes_guest_idx').on(t.guestId, t.issuedAt),
    check('guest_passes_token_hash_len', sql`octet_length(${t.tokenHash}) = 32`),
    check(
      'guest_passes_revoked_consistent',
      sql`(${t.status} = 'revoked') = (${t.revokedAt} IS NOT NULL)
       AND (${t.revokedAt} IS NULL) = (${t.revokeReason} IS NULL)`,
    ),
    check(
      'guest_passes_replaced_consistent',
      sql`${t.replacedByPassId} IS NULL OR ${t.revokeReason} = 'replaced'`,
    ),
  ],
);

/** The event's invitation look (one per event; defaults come from code until first saved). */
export const invitationDesigns = pgTable(
  'invitation_designs',
  {
    eventId: uuid('event_id')
      .primaryKey()
      .references(() => events.id, { onDelete: 'cascade' }),
    template: invitationTemplate('template').notNull(),
    primaryColor: text('primary_color').notNull(),
    title: text('title'),
    bodyText: text('body_text'),
    showDate: boolean('show_date').notNull().default(true),
    showTime: boolean('show_time').notNull().default(true),
    showVenue: boolean('show_venue').notNull().default(true),
    showAddress: boolean('show_address').notNull().default(true),
    showMap: boolean('show_map').notNull().default(true),
    showDescription: boolean('show_description').notNull().default(true),
    showCountdown: boolean('show_countdown').notNull().default(true),
    updatedByMembershipId: uuid('updated_by_membership_id').references(() => eventMemberships.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    check('invitation_designs_color', sql`${t.primaryColor} ~ '^#[0-9a-f]{6}$'`),
    check(
      'invitation_designs_title_len',
      sql`${t.title} IS NULL OR char_length(${t.title}) BETWEEN 1 AND 120`,
    ),
    check(
      'invitation_designs_body_len',
      sql`${t.bodyText} IS NULL OR char_length(${t.bodyText}) BETWEEN 1 AND 600`,
    ),
  ],
);

/** The prepared share text per event (Arabic by default). `{link}` is always kept. */
export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    type: messageType('type').notNull(),
    locale: locale('locale').notNull(),
    body: text('body').notNull(),
    updatedByMembershipId: uuid('updated_by_membership_id').references(() => eventMemberships.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('message_templates_one').on(t.eventId, t.type, t.locale),
    check(
      'message_templates_body',
      sql`char_length(${t.body}) BETWEEN 1 AND 1000 AND position('{link}' in ${t.body}) > 0`,
    ),
  ],
);
