import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { guestSource, guestStatus, importDecision, importRowState, importStatus } from './enums';
import { eventMemberships, events } from './events';
import { citext } from './identity';

const ts = (name: string) => timestamp(name, { withTimezone: true });

/** One group per guest. Names are unique per event, ignoring case and extra spaces. */
export const guestGroups = pgTable(
  'guest_groups',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('guest_groups_event_id_id').on(t.eventId, t.id),
    uniqueIndex('guest_groups_event_name').on(t.eventId, sql`lower(${t.name})`),
    check(
      'guest_groups_name_clean',
      sql`char_length(${t.name}) BETWEEN 1 AND 60 AND ${t.name} = btrim(${t.name})`,
    ),
  ],
);

/**
 * The invited party lead, scoped to one event (never a global contact). Identity is the UUID;
 * phone numbers are not unique, because two guests may share one. Its row is the per-guest lock.
 */
export const guests = pgTable(
  'guests',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    groupId: uuid('group_id'),
    fullName: text('full_name').notNull(),
    /** Normalized Arabic/Latin form for search only; never shown. */
    nameSearch: text('name_search').notNull(),
    phoneOriginal: text('phone_original'),
    phoneE164: text('phone_e164'),
    email: citext('email'),
    allowedCompanions: smallint('allowed_companions').notNull(),
    notes: text('notes'),
    source: guestSource('source').notNull(),
    status: guestStatus('status').notNull().default('active'),
    cancelledAt: ts('cancelled_at'),
    cancelReason: text('cancel_reason'),
    anonymizedAt: ts('anonymized_at'),
    importRowId: uuid('import_row_id').references((): AnyPgColumn => importRows.id, {
      onDelete: 'set null',
    }),
    createdByMembershipId: uuid('created_by_membership_id').references(() => eventMemberships.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('guests_event_id_id').on(t.eventId, t.id),
    // A guest can only be in a group of its own event.
    foreignKey({
      name: 'guests_group_fk',
      columns: [t.eventId, t.groupId],
      foreignColumns: [guestGroups.eventId, guestGroups.id],
    }),
    uniqueIndex('guests_import_row_once')
      .on(t.importRowId)
      .where(sql`${t.importRowId} IS NOT NULL`),
    index('guests_event_phone_idx').on(t.eventId, t.phoneE164),
    index('guests_event_status_group_idx').on(t.eventId, t.status, t.groupId),
    index('guests_event_created_idx').on(t.eventId, t.createdAt),
    index('guests_name_search_trgm').using('gin', sql`${t.nameSearch} gin_trgm_ops`),
    check(
      'guests_name_len',
      sql`${t.anonymizedAt} IS NOT NULL OR char_length(${t.fullName}) BETWEEN 1 AND 150`,
    ),
    check(
      'guests_phone_format',
      sql`${t.phoneE164} IS NULL OR ${t.phoneE164} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    check(
      'guests_phone_required',
      sql`${t.source} = 'walk_in' OR ${t.phoneE164} IS NOT NULL OR ${t.anonymizedAt} IS NOT NULL`,
    ),
    check('guests_companions_range', sql`${t.allowedCompanions} BETWEEN 0 AND 20`),
    check('guests_email_len', sql`${t.email} IS NULL OR char_length(${t.email}) <= 254`),
    check('guests_notes_len', sql`${t.notes} IS NULL OR char_length(${t.notes}) <= 1000`),
    check(
      'guests_cancellation_consistent',
      sql`(${t.status} = 'cancelled') = (${t.cancelledAt} IS NOT NULL)
       AND (${t.cancelReason} IS NULL OR ${t.status} = 'cancelled')`,
    ),
    check(
      'guests_cancel_reason_len',
      sql`${t.cancelReason} IS NULL OR char_length(${t.cancelReason}) BETWEEN 1 AND 300`,
    ),
    check('guests_import_source', sql`${t.importRowId} IS NULL OR ${t.source} = 'excel_import'`),
  ],
);

/**
 * One uploaded spreadsheet. The file itself is not kept: its rows are staged in import_rows
 * and only a hash of the upload is stored.
 */
export const importBatches = pgTable(
  'import_batches',
  {
    id: uuid('id').primaryKey(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => events.id),
    status: importStatus('status').notNull(),
    originalFilename: text('original_filename').notNull(),
    fileSha256: text('file_sha256').notNull(),
    fileSize: integer('file_size').notNull(),
    rowCount: integer('row_count').notNull().default(0),
    readyCount: integer('ready_count').notNull().default(0),
    reviewCount: integer('review_count').notNull().default(0),
    invalidCount: integer('invalid_count').notNull().default(0),
    importedCount: integer('imported_count'),
    skippedCount: integer('skipped_count'),
    /** Why parsing failed (e.g. missing_headers); never row data. */
    errorCode: text('error_code'),
    errorDetail: jsonb('error_detail'),
    uploadedByMembershipId: uuid('uploaded_by_membership_id')
      .notNull()
      .references(() => eventMemberships.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    parsedAt: ts('parsed_at'),
    committedAt: ts('committed_at'),
    discardedAt: ts('discarded_at'),
  },
  (t) => [
    unique('import_batches_event_id_id').on(t.eventId, t.id),
    index('import_batches_event_idx').on(t.eventId, t.createdAt),
    uniqueIndex('import_batches_one_committing')
      .on(t.eventId)
      .where(sql`${t.status} = 'committing'`),
    check(
      'import_batches_committed_consistent',
      sql`(${t.status} = 'committed') = (${t.committedAt} IS NOT NULL)`,
    ),
    check(
      'import_batches_failed_has_code',
      sql`${t.status} <> 'failed' OR ${t.errorCode} IS NOT NULL`,
    ),
  ],
);

/** Staged spreadsheet rows: original cells, parsed values, validation and the owner's decision. */
export const importRows = pgTable(
  'import_rows',
  {
    id: uuid('id').primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => importBatches.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').notNull(),
    rowNumber: integer('row_number').notNull(),
    raw: jsonb('raw').notNull(),
    fullName: text('full_name'),
    phoneOriginal: text('phone_original'),
    phoneE164: text('phone_e164'),
    email: text('email'),
    groupName: text('group_name'),
    allowedCompanions: smallint('allowed_companions'),
    notes: text('notes'),
    validation: importRowState('validation').notNull(),
    issues: jsonb('issues').notNull().default([]),
    decision: importDecision('decision'),
    guestId: uuid('guest_id'),
  },
  (t) => [
    unique('import_rows_batch_row').on(t.batchId, t.rowNumber),
    foreignKey({
      name: 'import_rows_batch_event_fk',
      columns: [t.eventId, t.batchId],
      foreignColumns: [importBatches.eventId, importBatches.id],
    }).onDelete('cascade'),
    index('import_rows_batch_state_idx').on(t.batchId, t.validation, t.rowNumber),
    check(
      'import_rows_invalid_not_imported',
      sql`${t.validation} <> 'invalid' OR ${t.decision} IS NULL OR ${t.decision} = 'skip'`,
    ),
  ],
);
