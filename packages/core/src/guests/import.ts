import { createHash } from 'node:crypto';
import { guestGroups, guests, importBatches, importRows } from '@gp/db/schema';
import { and, asc, count, desc, eq, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import { type ActivityInput, recordActivities, recordActivity } from '../activity/activity';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError, isDomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import { parsePhone, toAsciiDigits } from '../shared/phone';
import { cleanText, searchForm } from '../shared/text';
import { requireGuestManagement, requireGuestView } from './access';
import { groupKey, insertGroup, MAX_GROUPS_PER_EVENT } from './groups';
import { EMAIL_MAX, MAX_COMPANIONS, NAME_MAX, NOTES_MAX } from './schemas';
import { IMPORT_LIMITS, readSpreadsheet, type SheetColumn, writeXlsx } from './spreadsheet';

/* ------------------------------------------------------------------------------------------ */
/* Columns                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export const IMPORT_FIELDS = [
  'fullName',
  'phone',
  'email',
  'group',
  'companions',
  'notes',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const REQUIRED_FIELDS: ImportField[] = ['fullName', 'phone'];

/** The template's headers, in order. */
export const TEMPLATE_HEADERS: Record<ImportField, string> = {
  fullName: 'الاسم',
  phone: 'رقم الجوال',
  email: 'البريد الإلكتروني',
  group: 'المجموعة',
  companions: 'عدد المرافقين المسموح',
  notes: 'ملاحظات',
};

/**
 * Header spellings each column is recognized by, compared after the same normalization as
 * name search (so أ/إ/ا, ة/ه, case and extra spaces don't matter). Anything else is ignored.
 */
export const HEADER_ALIASES: Record<ImportField, string[]> = {
  fullName: [
    'الاسم',
    'اسم الضيف',
    'الاسم الكامل',
    'الاسم الثلاثي',
    'اسم',
    'name',
    'full name',
    'guest name',
    'guest',
  ],
  phone: [
    'رقم الجوال',
    'الجوال',
    'جوال',
    'رقم الهاتف',
    'الهاتف',
    'رقم الموبايل',
    'الموبايل',
    'الرقم',
    'phone',
    'phone number',
    'mobile',
    'mobile number',
    'mobile no',
  ],
  email: [
    'البريد الإلكتروني',
    'البريد الالكتروني',
    'البريد',
    'الإيميل',
    'ايميل',
    'email',
    'e-mail',
    'email address',
  ],
  group: ['المجموعة', 'مجموعة', 'الفئة', 'group', 'category'],
  companions: [
    'عدد المرافقين المسموح',
    'عدد المرافقين المسموح بهم',
    'عدد المرافقين',
    'المرافقين',
    'المرافقون',
    'مرافقين',
    'companions',
    'allowed companions',
    'plus ones',
    'plus-ones',
  ],
  notes: ['ملاحظات', 'الملاحظات', 'ملاحظة', 'notes', 'note', 'remarks'],
};

const headerKey = (h: string) =>
  searchForm(h)
    .replace(/[^\p{L}\p{N} ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const ALIAS_INDEX = new Map<string, ImportField>(
  IMPORT_FIELDS.flatMap((f) => HEADER_ALIASES[f].map((a) => [headerKey(a), f] as const)),
);

/** Maps header cells to fields. The first column matching a field wins. */
export function mapHeaders(header: string[]): {
  columns: Partial<Record<ImportField, number>>;
  missing: ImportField[];
  ignored: string[];
} {
  const columns: Partial<Record<ImportField, number>> = {};
  const ignored: string[] = [];
  header.forEach((cell, i) => {
    const label = cleanText(cell);
    if (!label) return;
    const field = ALIAS_INDEX.get(headerKey(label));
    if (field && columns[field] === undefined) columns[field] = i;
    else ignored.push(label.slice(0, 60));
  });
  return { columns, missing: REQUIRED_FIELDS.filter((f) => columns[f] === undefined), ignored };
}

/** The empty template: headers only (an example row could be imported by mistake). */
export function importTemplate(): Uint8Array {
  const widths: Record<ImportField, number> = {
    fullName: 30,
    phone: 18,
    email: 28,
    group: 18,
    companions: 22,
    notes: 36,
  };
  const columns: SheetColumn[] = IMPORT_FIELDS.map((f) => ({
    header: TEMPLATE_HEADERS[f],
    width: widths[f],
    text: f === 'phone',
  }));
  return writeXlsx('الضيوف', columns, []);
}

/* ------------------------------------------------------------------------------------------ */
/* Row validation                                                                              */
/* ------------------------------------------------------------------------------------------ */

export type IssueCode =
  // invalid: the row can't be imported as it is
  | 'missing_name'
  | 'name_too_long'
  | 'missing_phone'
  | 'invalid_phone'
  | 'unsupported_phone'
  | 'invalid_email'
  | 'invalid_companions'
  | 'notes_too_long'
  | 'group_too_long'
  | 'group_limit'
  // needs review: the owner decides
  | 'duplicate_existing'
  | 'same_guest_exists'
  | 'duplicate_in_file'
  | 'repeated_row'
  // information on a ready row
  | 'new_group'
  | 'companions_default';

export interface RowIssue {
  code: IssueCode;
  severity: 'invalid' | 'review' | 'info';
  /** For duplicates: the matching guests (ids only; names are looked up when shown). */
  guestIds?: string[];
  /** For in-file duplicates: the earlier row's number. */
  row?: number;
}

export interface ParsedRow {
  rowNumber: number;
  raw: Partial<Record<ImportField, string>>;
  fullName: string | null;
  phoneOriginal: string | null;
  phoneE164: string | null;
  email: string | null;
  groupName: string | null;
  allowedCompanions: number | null;
  notes: string | null;
  validation: 'ready' | 'needs_review' | 'invalid';
  issues: RowIssue[];
  decision: 'import' | 'skip' | null;
}

interface ValidationContext {
  /** Existing guests by E.164 number. */
  byPhone: Map<string, { id: string; nameKey: string }[]>;
  /** Existing groups by case-insensitive key. */
  groups: Map<string, string>;
  groupCount: number;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Validates one row's cells on their own (no duplicates yet). Nothing is corrected. */
function checkCells(
  rowNumber: number,
  raw: Partial<Record<ImportField, string>>,
): Omit<ParsedRow, 'validation' | 'decision'> {
  const issues: RowIssue[] = [];
  const bad = (code: IssueCode) => issues.push({ code, severity: 'invalid' });

  const fullName = cleanText(raw.fullName ?? '');
  if (!fullName) bad('missing_name');
  else if (fullName.length > NAME_MAX) bad('name_too_long');

  const phoneOriginal = (raw.phone ?? '').trim();
  const phone = parsePhone(phoneOriginal);
  if (!phone.ok) bad(phone.problem);

  const email = (raw.email ?? '').trim();
  if (email && (email.length > EMAIL_MAX || !EMAIL.test(email))) bad('invalid_email');

  const groupName = cleanText(raw.group ?? '');
  if (groupName.length > 60) bad('group_too_long');

  const companionsText = toAsciiDigits(raw.companions ?? '').trim();
  let allowedCompanions: number | null = null;
  if (companionsText === '') issues.push({ code: 'companions_default', severity: 'info' });
  else if (/^[0-9]+(\.0+)?$/.test(companionsText) && Number(companionsText) <= MAX_COMPANIONS) {
    allowedCompanions = Number(companionsText);
  } else bad('invalid_companions');

  const notes = (raw.notes ?? '').trim();
  if (notes.length > NOTES_MAX) bad('notes_too_long');

  return {
    rowNumber,
    raw,
    fullName: fullName || null,
    phoneOriginal: phoneOriginal || null,
    phoneE164: phone.ok ? phone.e164 : null,
    email: email || null,
    groupName: groupName || null,
    allowedCompanions,
    notes: notes || null,
    issues,
  };
}

/**
 * Validates all rows together: cells, then duplicates against existing guests and earlier rows
 * of the file, then groups. Same phone is a review; same phone and same name is a repeat
 * the owner most likely wants skipped, so it starts as skip.
 */
export function validateRows(
  rows: { rowNumber: number; raw: Partial<Record<ImportField, string>> }[],
  vc: ValidationContext,
): ParsedRow[] {
  const seen = new Map<string, { row: number; nameKey: string }[]>();
  const newGroups = new Set<string>();
  return rows.map(({ rowNumber, raw }) => {
    const r = checkCells(rowNumber, raw);
    const issues = r.issues;
    const nameKey = r.fullName ? searchForm(r.fullName) : '';

    if (r.phoneE164) {
      const existing = vc.byPhone.get(r.phoneE164) ?? [];
      if (existing.length) {
        const same = existing.some((g) => g.nameKey === nameKey);
        issues.push({
          code: same ? 'same_guest_exists' : 'duplicate_existing',
          severity: 'review',
          guestIds: existing.slice(0, 5).map((g) => g.id),
        });
      }
      const earlier = seen.get(r.phoneE164) ?? [];
      if (earlier.length) {
        const same = earlier.find((e) => e.nameKey === nameKey);
        issues.push({
          code: same ? 'repeated_row' : 'duplicate_in_file',
          severity: 'review',
          row: (same ?? earlier[0]!).row,
        });
      }
      seen.set(r.phoneE164, [...earlier, { row: rowNumber, nameKey }]);
    }

    if (r.groupName && r.groupName.length <= 60) {
      const key = groupKey(r.groupName);
      if (!vc.groups.has(key)) {
        if (!newGroups.has(key) && vc.groupCount + newGroups.size >= MAX_GROUPS_PER_EVENT) {
          issues.push({ code: 'group_limit', severity: 'invalid' });
        } else {
          newGroups.add(key);
          issues.push({ code: 'new_group', severity: 'info' });
        }
      }
    }

    const validation = issues.some((i) => i.severity === 'invalid')
      ? 'invalid'
      : issues.some((i) => i.severity === 'review')
        ? 'needs_review'
        : 'ready';
    const repeat = issues.some((i) => i.code === 'repeated_row' || i.code === 'same_guest_exists');
    const decision =
      validation === 'invalid'
        ? 'skip'
        : validation === 'ready'
          ? 'import'
          : repeat
            ? 'skip'
            : null;
    // An invalid row won't be imported, so notes about how it would have been are noise.
    const shown =
      validation === 'invalid' ? issues.filter((i) => i.severity === 'invalid') : issues;
    return { ...r, issues: shown, validation, decision };
  });
}

async function validationContext(db: DbOrTx, eventId: string): Promise<ValidationContext> {
  const [existing, groups] = await Promise.all([
    db
      .select({ id: guests.id, phoneE164: guests.phoneE164, nameSearch: guests.nameSearch })
      .from(guests)
      .where(and(eq(guests.eventId, eventId), isNull(guests.anonymizedAt))),
    db
      .select({ id: guestGroups.id, name: guestGroups.name })
      .from(guestGroups)
      .where(eq(guestGroups.eventId, eventId)),
  ]);
  const byPhone = new Map<string, { id: string; nameKey: string }[]>();
  for (const g of existing) {
    if (!g.phoneE164) continue;
    byPhone.set(g.phoneE164, [
      ...(byPhone.get(g.phoneE164) ?? []),
      { id: g.id, nameKey: g.nameSearch },
    ]);
  }
  return {
    byPhone,
    groups: new Map(groups.map((g) => [groupKey(g.name), g.id])),
    groupCount: groups.length,
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Upload and parse                                                                            */
/* ------------------------------------------------------------------------------------------ */

export type ImportBatchRow = typeof importBatches.$inferSelect;

function counts(rows: ParsedRow[]) {
  return {
    rowCount: rows.length,
    readyCount: rows.filter((r) => r.validation === 'ready').length,
    reviewCount: rows.filter((r) => r.validation === 'needs_review').length,
    invalidCount: rows.filter((r) => r.validation === 'invalid').length,
  };
}

/**
 * Stages an uploaded file for review. Nothing here creates guests. The file itself is not
 * stored: its rows go to import_rows, and the batch keeps only its name, size and hash.
 * A file that can't be read ends as a `failed` batch with a reason, so the owner sees why.
 * Uploading the same file again while its review is still open returns that review.
 */
export async function createImportBatch(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  file: { name: string; bytes: Uint8Array },
): Promise<{ batchId: string; status: ImportBatchRow['status'] }> {
  const { event, actor } = await requireGuestManagement(ctx.db, userId, eventId);
  const sha = createHash('sha256').update(file.bytes).digest('hex');
  const [open] = await ctx.db
    .select({ id: importBatches.id, status: importBatches.status })
    .from(importBatches)
    .where(
      and(
        eq(importBatches.eventId, eventId),
        eq(importBatches.fileSha256, sha),
        eq(importBatches.status, 'parsed'),
      ),
    );
  if (open) return { batchId: open.id, status: open.status };

  const batchId = newId();
  const filename = cleanText(file.name.replace(/[\\/]/g, ' ')).slice(0, 200) || 'file';
  await ctx.db.transaction(async (tx) => {
    await tx.insert(importBatches).values({
      id: batchId,
      eventId,
      status: 'uploaded',
      originalFilename: filename,
      fileSha256: sha,
      fileSize: file.bytes.length,
      uploadedByMembershipId: actor.membershipId,
    });
    await recordActivity(tx, {
      type: 'guest_import.created',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { batchId, fileSize: file.bytes.length },
    });
  });

  const fail = async (code: string, detail: Record<string, unknown> = {}) => {
    await ctx.db.transaction(async (tx) => {
      await tx
        .update(importBatches)
        .set({ status: 'failed', errorCode: code, errorDetail: detail, updatedAt: ctx.now() })
        .where(eq(importBatches.id, batchId));
      await recordActivity(tx, {
        type: 'guest_import.failed',
        actor,
        eventId,
        workspaceId: event.workspaceId,
        data: { batchId, code },
      });
    });
    return { batchId, status: 'failed' as const };
  };

  let rows: string[][];
  try {
    rows = readSpreadsheet(file.bytes).rows;
  } catch (err) {
    if (isDomainError(err)) return fail(err.code);
    return fail('file_unreadable');
  }

  const headerAt = rows.findIndex((r) => r.some((c) => c.trim() !== ''));
  if (headerAt === -1) return fail('file_empty');
  const { columns, missing, ignored } = mapHeaders(rows[headerAt]!);
  if (missing.length) {
    return fail('missing_headers', {
      missing,
      found: rows[headerAt]!.map((c) => cleanText(c).slice(0, 60)).filter(Boolean),
    });
  }
  const data = rows
    .slice(headerAt + 1)
    .map((cells, i) => ({ cells, rowNumber: headerAt + 2 + i }))
    .filter(({ cells }) => cells.some((c) => c.trim() !== ''));
  if (data.length === 0) return fail('file_empty');
  if (data.length > IMPORT_LIMITS.maxRows)
    return fail('too_many_rows', { limit: IMPORT_LIMITS.maxRows });

  const input = data.map(({ cells, rowNumber }) => {
    const raw: Partial<Record<ImportField, string>> = {};
    for (const f of IMPORT_FIELDS) {
      const at = columns[f];
      if (at !== undefined && cells[at]) raw[f] = cells[at];
    }
    return { rowNumber, raw };
  });

  return ctx.db.transaction(async (tx) => {
    await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    const parsed = validateRows(input, await validationContext(tx, eventId));
    for (let i = 0; i < parsed.length; i += 500) {
      await tx.insert(importRows).values(
        parsed.slice(i, i + 500).map((r) => ({
          id: newId(),
          batchId,
          eventId,
          rowNumber: r.rowNumber,
          raw: r.raw,
          fullName: r.fullName,
          phoneOriginal: r.phoneOriginal,
          phoneE164: r.phoneE164,
          email: r.email,
          groupName: r.groupName,
          allowedCompanions: r.allowedCompanions,
          notes: r.notes,
          validation: r.validation,
          issues: r.issues,
          decision: r.decision,
        })),
      );
    }
    const c = counts(parsed);
    const now = ctx.now();
    await tx
      .update(importBatches)
      .set({
        status: 'parsed',
        ...c,
        errorDetail: ignored.length ? { ignoredColumns: ignored } : null,
        parsedAt: now,
        updatedAt: now,
      })
      .where(eq(importBatches.id, batchId));
    await recordActivity(tx, {
      type: 'guest_import.parsed',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: {
        batchId,
        rows: c.rowCount,
        ready: c.readyCount,
        review: c.reviewCount,
        invalid: c.invalidCount,
      },
    });
    return { batchId, status: 'parsed' as const };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Review                                                                                      */
/* ------------------------------------------------------------------------------------------ */

async function loadBatch(db: DbOrTx, eventId: string, batchId: string, lock = false) {
  const q = db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.eventId, eventId), eq(importBatches.id, batchId)));
  const [batch] = await (lock ? q.for('update') : q);
  if (!batch) throw new DomainError('not_found');
  return batch;
}

export async function getImportBatch(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  batchId: string,
) {
  await requireGuestView(ctx.db, userId, eventId);
  const batch = await loadBatch(ctx.db, eventId, batchId);
  const [pending] = (await ctx.db
    .select({
      undecided:
        sql<number>`count(*) FILTER (WHERE ${importRows.validation} = 'needs_review' AND ${importRows.decision} IS NULL)`.mapWith(
          Number,
        ),
      toImport:
        sql<number>`count(*) FILTER (WHERE ${importRows.decision} IN ('import', 'add_anyway'))`.mapWith(
          Number,
        ),
      toSkip: sql<number>`count(*) FILTER (WHERE ${importRows.decision} = 'skip')`.mapWith(Number),
      newGroups:
        sql<number>`count(DISTINCT lower(${importRows.groupName})) FILTER (WHERE ${importRows.issues} @> '[{"code":"new_group"}]' AND ${importRows.decision} IN ('import', 'add_anyway'))`.mapWith(
          Number,
        ),
    })
    .from(importRows)
    .where(eq(importRows.batchId, batchId))) as [
    { undecided: number; toImport: number; toSkip: number; newGroups: number },
  ];
  return { ...batch, ...pending };
}

/** The latest imports of the event (for "continue reviewing"). */
export async function listImportBatches(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  limit = 5,
) {
  await requireGuestView(ctx.db, userId, eventId);
  return ctx.db
    .select()
    .from(importBatches)
    .where(eq(importBatches.eventId, eventId))
    .orderBy(desc(importBatches.createdAt))
    .limit(limit);
}

export const ROW_FILTERS = [
  'all',
  'ready',
  'needs_review',
  'invalid',
  'undecided',
  'skipped',
] as const;
export type RowFilter = (typeof ROW_FILTERS)[number];

function rowFilter(filter: RowFilter): SQL | undefined {
  switch (filter) {
    case 'ready':
    case 'needs_review':
    case 'invalid':
      return eq(importRows.validation, filter);
    case 'undecided':
      return and(eq(importRows.validation, 'needs_review'), isNull(importRows.decision));
    case 'skipped':
      return eq(importRows.decision, 'skip');
    default:
      return undefined;
  }
}

export type ImportRowItem = typeof importRows.$inferSelect & {
  issues: RowIssue[];
  /** Existing guests named in duplicate issues, for showing who they are. */
  matches: {
    id: string;
    fullName: string;
    groupName: string | null;
    status: 'active' | 'cancelled';
  }[];
};

export async function listImportRows(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  batchId: string,
  opts: { filter?: RowFilter; page?: number; pageSize?: number } = {},
): Promise<{ rows: ImportRowItem[]; total: number; page: number; pages: number }> {
  await requireGuestView(ctx.db, userId, eventId);
  await loadBatch(ctx.db, eventId, batchId);
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const where = and(eq(importRows.batchId, batchId), rowFilter(opts.filter ?? 'all'));
  const [{ total }] = (await ctx.db.select({ total: count() }).from(importRows).where(where)) as [
    { total: number },
  ];
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, opts.page ?? 1), pages);
  const rows = await ctx.db
    .select()
    .from(importRows)
    .where(where)
    // Rows that need attention first, then in file order.
    .orderBy(
      sql`CASE ${importRows.validation} WHEN 'needs_review' THEN 0 WHEN 'invalid' THEN 1 ELSE 2 END`,
      asc(importRows.rowNumber),
    )
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const ids = [
    ...new Set(rows.flatMap((r) => (r.issues as RowIssue[]).flatMap((i) => i.guestIds ?? []))),
  ];
  const found = ids.length
    ? await ctx.db
        .select({
          id: guests.id,
          fullName: guests.fullName,
          groupName: guestGroups.name,
          status: guests.status,
        })
        .from(guests)
        .leftJoin(guestGroups, eq(guestGroups.id, guests.groupId))
        .where(and(eq(guests.eventId, eventId), inArray(guests.id, ids)))
    : [];
  const byId = new Map(found.map((g) => [g.id, g]));
  return {
    rows: rows.map((r) => {
      const issues = r.issues as RowIssue[];
      return {
        ...r,
        issues,
        matches: issues
          .flatMap((i) => i.guestIds ?? [])
          .map((id) => byId.get(id))
          .filter((g) => g !== undefined),
      };
    }),
    total,
    page,
    pages,
  };
}

export const ROW_DECISIONS = ['import', 'skip', 'add_anyway'] as const;
export type RowDecision = (typeof ROW_DECISIONS)[number];

/** Which decisions a row may take: ready rows import or skip, reviews add anyway or skip. */
function decisionAllowed(validation: string, decision: RowDecision): boolean {
  if (validation === 'invalid') return decision === 'skip';
  if (validation === 'ready') return decision === 'import' || decision === 'skip';
  return decision === 'add_anyway' || decision === 'skip';
}

/**
 * Sets the decision on some rows of a batch still in review: the given row ids, or every row in
 * `filter` (e.g. skip all rows that need review). Rows the decision doesn't apply to are left.
 */
export async function setImportDecisions(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  batchId: string,
  target: { rowIds: string[] } | { filter: RowFilter },
  decision: string,
) {
  if (!(ROW_DECISIONS as readonly string[]).includes(decision))
    throw new DomainError('invalid_decision');
  const d = decision as RowDecision;
  return ctx.db.transaction(async (tx) => {
    await requireGuestManagement(tx, userId, eventId);
    const batch = await loadBatch(tx, eventId, batchId, true);
    if (batch.status !== 'parsed')
      throw new DomainError('import_not_ready', undefined, { status: batch.status });
    const allowedStates = (['ready', 'needs_review', 'invalid'] as const).filter((s) =>
      decisionAllowed(s, d),
    );
    const scope =
      'rowIds' in target
        ? inArray(importRows.id, target.rowIds.slice(0, 5000))
        : rowFilter(target.filter);
    if ('rowIds' in target && target.rowIds.length === 1) {
      const [row] = await tx
        .select({ validation: importRows.validation })
        .from(importRows)
        .where(and(eq(importRows.batchId, batchId), eq(importRows.id, target.rowIds[0]!)));
      if (!row) throw new DomainError('not_found');
      if (!decisionAllowed(row.validation, d)) throw new DomainError('invalid_decision');
    }
    const updated = await tx
      .update(importRows)
      .set({ decision: d })
      .where(
        and(eq(importRows.batchId, batchId), inArray(importRows.validation, allowedStates), scope),
      )
      .returning({ id: importRows.id });
    await tx
      .update(importBatches)
      .set({ updatedAt: ctx.now() })
      .where(eq(importBatches.id, batchId));
    return { updated: updated.length };
  });
}

/** Drops a review. Its staged rows are deleted right away; the batch stays as a record. */
export async function discardImport(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  batchId: string,
) {
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId);
    const batch = await loadBatch(tx, eventId, batchId, true);
    if (batch.status === 'discarded') return { changed: false };
    if (batch.status !== 'parsed' && batch.status !== 'failed' && batch.status !== 'uploaded') {
      throw new DomainError('import_not_ready', undefined, { status: batch.status });
    }
    const now = ctx.now();
    await tx.delete(importRows).where(eq(importRows.batchId, batchId));
    await tx
      .update(importBatches)
      .set({ status: 'discarded', discardedAt: now, updatedAt: now })
      .where(eq(importBatches.id, batchId));
    await recordActivity(tx, {
      type: 'guest_import.discarded',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { batchId },
    });
    return { changed: true };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Commit                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export type CommitResult =
  | {
      status: 'committed';
      imported: number;
      skipped: number;
      groupsCreated: number;
      already: boolean;
    }
  /** The guest list changed since the review: these rows were re-checked and need a decision. */
  | { status: 'changed'; rowsChanged: number };

/**
 * Creates the guests the owner chose, in one transaction. Everything is checked again here:
 * the batch must still be in review, every row that needs a decision has one, and rows are
 * re-validated against the guest list as it is now. If another guest with the same phone
 * appeared since the review, those rows go back to review and nothing is imported.
 *
 * Safe to retry: the batch row is locked, a committed batch returns its earlier result, and
 * each staged row can create at most one guest (unique import_row_id).
 */
export async function commitImport(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  batchId: string,
): Promise<CommitResult> {
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireGuestManagement(tx, userId, eventId, { forUpdate: true });
    const batch = await loadBatch(tx, eventId, batchId, true);
    if (batch.status === 'committed') {
      return {
        status: 'committed',
        imported: batch.importedCount ?? 0,
        skipped: batch.skippedCount ?? 0,
        groupsCreated: 0,
        already: true,
      };
    }
    if (batch.status !== 'parsed')
      throw new DomainError('import_not_ready', undefined, { status: batch.status });
    await tx
      .update(importBatches)
      .set({ status: 'committing', updatedAt: ctx.now() })
      .where(eq(importBatches.id, batchId));

    const staged = await tx
      .select()
      .from(importRows)
      .where(eq(importRows.batchId, batchId))
      .orderBy(asc(importRows.rowNumber));
    const undecided = staged.filter((r) => r.decision === null).length;
    if (undecided)
      throw new DomainError('import_decisions_missing', undefined, { count: undecided });
    for (const r of staged) {
      if (!decisionAllowed(r.validation, r.decision!)) throw new DomainError('invalid_decision');
    }

    // Re-check against the list as it is now; rows that were ready may have become duplicates.
    const vc = await validationContext(tx, eventId);
    const fresh = validateRows(
      staged.map((r) => ({
        rowNumber: r.rowNumber,
        raw: r.raw as Partial<Record<ImportField, string>>,
      })),
      vc,
    );
    // Only rows that got worse matter: a chosen row that is now invalid, or a ready row that
    // now needs a decision. A row already added anyway stays chosen while it is only a review.
    const changed = staged.filter((r, i) => {
      const f = fresh[i]!;
      if (r.decision === 'skip') return false;
      return (
        f.validation === 'invalid' || (f.validation === 'needs_review' && r.validation === 'ready')
      );
    });
    if (changed.length) {
      for (const r of changed) {
        const f = fresh[staged.indexOf(r)]!;
        await tx
          .update(importRows)
          .set({ validation: f.validation, issues: f.issues, decision: f.decision })
          .where(eq(importRows.id, r.id));
      }
      const c = counts(
        staged.map((r, i) =>
          changed.includes(r) ? fresh[i]! : ({ validation: r.validation } as ParsedRow),
        ),
      );
      await tx
        .update(importBatches)
        .set({
          status: 'parsed',
          readyCount: c.readyCount,
          reviewCount: c.reviewCount,
          invalidCount: c.invalidCount,
          updatedAt: ctx.now(),
        })
        .where(eq(importBatches.id, batchId));
      return { status: 'changed', rowsChanged: changed.length };
    }

    const chosen = staged.filter((r) => r.decision === 'import' || r.decision === 'add_anyway');
    const now = ctx.now();
    const entries: ActivityInput[] = [];

    // Groups: link existing ones by name; create the new ones the chosen rows name, once each.
    const groupIds = new Map(vc.groups);
    let groupsCreated = 0;
    for (const r of chosen) {
      if (!r.groupName) continue;
      const key = groupKey(r.groupName);
      if (groupIds.has(key)) continue;
      const id = await insertGroup(tx, eventId, r.groupName, now);
      groupIds.set(key, id);
      groupsCreated++;
      entries.push({
        type: 'guest_group.created',
        actor,
        eventId,
        workspaceId: event.workspaceId,
        data: { groupId: id, batchId },
      });
    }

    const newGuests = chosen.map((r) => ({
      id: newId(),
      eventId,
      groupId: r.groupName ? groupIds.get(groupKey(r.groupName))! : null,
      fullName: r.fullName!,
      nameSearch: searchForm(r.fullName!),
      phoneOriginal: r.phoneOriginal,
      phoneE164: r.phoneE164,
      email: r.email,
      allowedCompanions: r.allowedCompanions ?? event.defaultAllowedCompanions,
      notes: r.notes,
      source: 'excel_import' as const,
      importRowId: r.id,
      createdByMembershipId: actor.membershipId,
      createdAt: now,
      updatedAt: now,
    }));
    for (let i = 0; i < newGuests.length; i += 500) {
      await tx.insert(guests).values(newGuests.slice(i, i + 500));
    }
    await tx.execute(sql`
      UPDATE import_rows r SET guest_id = g.id
      FROM guests g
      WHERE g.import_row_id = r.id AND r.batch_id = ${batchId}`);

    for (const [i, g] of newGuests.entries()) {
      entries.push({
        type: 'guest.created',
        actor,
        eventId,
        workspaceId: event.workspaceId,
        guestId: g.id,
        data: {
          source: 'excel_import',
          batchId,
          row: chosen[i]!.rowNumber,
          duplicateAcknowledged: chosen[i]!.decision === 'add_anyway',
        },
      });
    }
    const skipped = staged.length - chosen.length;
    entries.push({
      type: 'guest_import.committed',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { batchId, imported: chosen.length, skipped, groupsCreated },
    });
    await recordActivities(tx, entries);
    await tx
      .update(importBatches)
      .set({
        status: 'committed',
        importedCount: chosen.length,
        skippedCount: skipped,
        committedAt: now,
        updatedAt: now,
      })
      .where(eq(importBatches.id, batchId));
    return { status: 'committed', imported: chosen.length, skipped, groupsCreated, already: false };
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Error report and retention                                                                  */
/* ------------------------------------------------------------------------------------------ */

/**
 * An .xlsx of the rows that were not (or will not be) imported, with the original cells and
 * why. `describe` turns issue codes into the owner's language. Cells are formula-escaped.
 */
export async function importProblemReport(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  batchId: string,
  labels: { row: string; problem: string; describe: (issue: RowIssue) => string },
): Promise<Uint8Array> {
  await requireGuestView(ctx.db, userId, eventId);
  await loadBatch(ctx.db, eventId, batchId);
  const rows = await ctx.db
    .select()
    .from(importRows)
    .where(
      and(
        eq(importRows.batchId, batchId),
        sql`(${importRows.validation} <> 'ready' OR ${importRows.decision} = 'skip')`,
      ),
    )
    .orderBy(asc(importRows.rowNumber));
  const columns: SheetColumn[] = [
    { header: labels.row, width: 8 },
    ...IMPORT_FIELDS.map((f) => ({
      header: TEMPLATE_HEADERS[f],
      width: f === 'notes' ? 30 : 20,
      text: f === 'phone',
    })),
    { header: labels.problem, width: 60 },
  ];
  const data = rows.map((r) => {
    const raw = r.raw as Partial<Record<ImportField, string>>;
    const problems = (r.issues as RowIssue[])
      .filter((i) => i.severity !== 'info')
      .map(labels.describe);
    return [String(r.rowNumber), ...IMPORT_FIELDS.map((f) => raw[f] ?? ''), problems.join(' · ')];
  });
  return writeXlsx('مراجعة', columns, data);
}

/** Staged rows are kept 30 days after a commit (for the error report), then deleted. */
export const IMPORT_ROWS_RETENTION_DAYS = 30;

export async function purgeImportRows(db: DbOrTx, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - IMPORT_ROWS_RETENTION_DAYS * 86_400_000);
  const old = db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(
      and(
        ne(importBatches.status, 'parsed'),
        ne(importBatches.status, 'committing'),
        lt(importBatches.updatedAt, cutoff),
      ),
    );
  const deleted = await db
    .delete(importRows)
    .where(inArray(importRows.batchId, old))
    .returning({ id: importRows.id });
  return deleted.length;
}
