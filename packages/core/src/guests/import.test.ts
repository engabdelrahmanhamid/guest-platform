import { activity, guests, importBatches, importRows } from '@gp/db/schema';
import { strToU8 } from 'fflate';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEvent } from '../events/events';
import { createOwner, createTestContext, databaseUrl, eventInput } from '../testing/harness';
import { excelLikeXlsx, guestRows, TEMPLATE_ROW } from '../testing/xlsx';
import { createGroup, listGroups } from './groups';
import { addGuest, guestSummary, listGuests } from './guests';
import {
  commitImport,
  createImportBatch,
  discardImport,
  getImportBatch,
  importProblemReport,
  listImportRows,
  purgeImportRows,
  setImportDecisions,
} from './import';
import { readSpreadsheet } from './spreadsheet';

const code = (c: string) => expect.objectContaining({ code: c });

describe.skipIf(!databaseUrl)('excel import', () => {
  const ctx = createTestContext(new Date('2034-01-01T09:00:00Z'));

  async function setup() {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    const upload = (rows: (string | number | null)[][], name = 'guests.xlsx') =>
      createImportBatch(ctx, owner.userId, eventId, { name, bytes: excelLikeXlsx(rows) });
    return { userId: owner.userId, eventId, upload };
  }

  async function rowsOf(batchId: string) {
    return ctx.db
      .select()
      .from(importRows)
      .where(eq(importRows.batchId, batchId))
      .orderBy(importRows.rowNumber);
  }

  it('stages a clean file without creating guests, then commits it', async () => {
    const { userId, eventId, upload } = await setup();
    const { batchId, status } = await upload([TEMPLATE_ROW, ...guestRows(5)]);
    expect(status).toBe('parsed');
    expect((await guestSummary(ctx, userId, eventId)).total).toBe(0);
    const batch = await getImportBatch(ctx, userId, eventId, batchId);
    expect(batch).toMatchObject({
      rowCount: 5,
      readyCount: 5,
      reviewCount: 0,
      invalidCount: 0,
      undecided: 0,
      toImport: 5,
      newGroups: 2,
    });

    const result = await commitImport(ctx, userId, eventId, batchId);
    expect(result).toEqual({
      status: 'committed',
      imported: 5,
      skipped: 0,
      groupsCreated: 2,
      already: false,
    });
    const list = await listGuests(ctx, userId, eventId, { sort: 'name', source: 'excel_import' });
    expect(list.total).toBe(5);
    expect(list.rows[0]).toMatchObject({
      fullName: 'ضيف رقم 1',
      phoneE164: '+966550000000',
      groupName: 'العائلة',
      allowedCompanions: 0,
    });
    expect((await listGroups(ctx, userId, eventId)).map((g) => g.name)).toEqual([
      'العائلة',
      'الأصدقاء',
    ]);
    // Every staged row points at its guest, and every guest at its row.
    const staged = await rowsOf(batchId);
    expect(staged.every((r) => r.guestId)).toBe(true);
    const linked = await ctx.db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(guests)
      .where(
        sql`${guests.importRowId} IN (SELECT id FROM import_rows WHERE batch_id = ${batchId})`,
      );
    expect(linked[0]!.n).toBe(5);
    const types = await ctx.db
      .select({ type: activity.type })
      .from(activity)
      .where(and(eq(activity.eventId, eventId), sql`${activity.type} LIKE 'guest_import.%'`))
      .orderBy(activity.id);
    expect(types.map((t) => t.type)).toEqual([
      'guest_import.created',
      'guest_import.parsed',
      'guest_import.committed',
    ]);
  });

  it('is idempotent: committing again, even concurrently, creates nothing more', async () => {
    const { userId, eventId, upload } = await setup();
    const { batchId } = await upload([TEMPLATE_ROW, ...guestRows(20)]);
    const results = await Promise.all([
      commitImport(ctx, userId, eventId, batchId),
      commitImport(ctx, userId, eventId, batchId),
      commitImport(ctx, userId, eventId, batchId),
    ]);
    expect(results.filter((r) => r.status === 'committed' && !r.already)).toHaveLength(1);
    expect(results.filter((r) => r.status === 'committed' && r.already)).toHaveLength(2);
    expect((await guestSummary(ctx, userId, eventId)).total).toBe(20);
    expect(await commitImport(ctx, userId, eventId, batchId)).toMatchObject({
      imported: 20,
      already: true,
    });
    await expect(discardImport(ctx, userId, eventId, batchId)).rejects.toEqual(
      code('import_not_ready'),
    );
  });

  it('marks invalid rows with reasons and never corrects them', async () => {
    const { userId, eventId, upload } = await setup();
    const { batchId } = await upload([
      TEMPLATE_ROW,
      ['', '0551234567'],
      ['بلا جوال', ''],
      ['رقم قصير', '12345'],
      ['رقمان', '0551234567 / 0501234567'],
      ['بريد', '0501111111', 'not-an-email'],
      ['مرافقون', '0502222222', '', '', 'ثلاثة'],
      ['كثير', '0503333333', '', '', '25'],
      ['سليم', '٠٥٠٤٤٤٤٤٤٤', '', '', '٢'],
    ]);
    const rows = await rowsOf(batchId);
    const summary = rows.map((r) => [
      r.rowNumber,
      r.validation,
      (r.issues as { code: string }[]).map((i) => i.code),
    ]);
    expect(summary).toEqual([
      [2, 'invalid', ['missing_name']],
      [3, 'invalid', ['missing_phone']],
      [4, 'invalid', ['invalid_phone']],
      [5, 'invalid', ['unsupported_phone']],
      [6, 'invalid', ['invalid_email']],
      [7, 'invalid', ['invalid_companions']],
      [8, 'invalid', ['invalid_companions']],
      [9, 'ready', []],
    ]);
    expect(rows[0]!.decision).toBe('skip');
    expect(rows[7]).toMatchObject({
      phoneE164: '+966504444444',
      allowedCompanions: 2,
      decision: 'import',
    });
    // The original text is kept as it was typed.
    expect(rows[2]!.raw).toEqual({ fullName: 'رقم قصير', phone: '12345' });
    // Invalid rows can only be skipped.
    await expect(
      setImportDecisions(ctx, userId, eventId, batchId, { rowIds: [rows[0]!.id] }, 'add_anyway'),
    ).rejects.toEqual(code('invalid_decision'));
    expect(await commitImport(ctx, userId, eventId, batchId)).toMatchObject({
      imported: 1,
      skipped: 7,
    });

    const report = readSpreadsheet(
      await importProblemReport(ctx, userId, eventId, batchId, {
        row: 'الصف',
        problem: 'المشكلة',
        describe: (i) => i.code,
      }),
    ).rows;
    expect(report[0]).toEqual(['الصف', ...TEMPLATE_ROW, 'المشكلة']);
    expect(report).toHaveLength(8);
    expect(report[3]).toEqual(['4', 'رقم قصير', '12345', '', '', '', '', 'invalid_phone']);
  });

  it('flags duplicates against existing guests and within the file for a decision', async () => {
    const { userId, eventId, upload } = await setup();
    const existing = await addGuest(ctx, userId, eventId, {
      fullName: 'أحمد',
      phone: '0551234567',
    });
    const { batchId } = await upload([
      TEMPLATE_ROW,
      ['احمد', '+966551234567'], // same phone and name as a guest: likely the same person
      ['محمد', '551234567'], // same phone, different name
      ['سعد', '0509999999'],
      ['سعد', '00966509999999'], // repeated row in the file
      ['فهد', '0509999999'], // same phone as an earlier row, other name
    ]);
    const rows = await rowsOf(batchId);
    expect(
      rows.map((r) => [
        r.validation,
        r.decision,
        (r.issues as { code: string }[]).map((i) => i.code),
      ]),
    ).toEqual([
      ['needs_review', 'skip', ['companions_default', 'same_guest_exists']],
      ['needs_review', null, ['companions_default', 'duplicate_existing', 'duplicate_in_file']],
      ['ready', 'import', ['companions_default']],
      ['needs_review', 'skip', ['companions_default', 'repeated_row']],
      ['needs_review', null, ['companions_default', 'duplicate_in_file']],
    ]);
    expect((rows[1]!.issues as { guestIds?: string[] }[])[1]!.guestIds).toEqual([
      existing.status === 'saved' ? existing.guestId : '',
    ]);
    expect((rows[4]!.issues as { row?: number }[])[1]!.row).toBe(4);

    const listed = await listImportRows(ctx, userId, eventId, batchId, { filter: 'undecided' });
    expect(listed.total).toBe(2);
    expect(listed.rows[0]!.matches).toEqual([
      expect.objectContaining({ fullName: 'أحمد', status: 'active' }),
    ]);

    // Undecided rows block the commit.
    await expect(commitImport(ctx, userId, eventId, batchId)).rejects.toEqual(
      code('import_decisions_missing'),
    );
    await setImportDecisions(
      ctx,
      userId,
      eventId,
      batchId,
      { rowIds: [rows[1]!.id] },
      'add_anyway',
    );
    await setImportDecisions(ctx, userId, eventId, batchId, { filter: 'undecided' }, 'skip');
    await expect(
      setImportDecisions(ctx, userId, eventId, batchId, { rowIds: [rows[2]!.id] }, 'add_anyway'),
    ).rejects.toEqual(code('invalid_decision'));
    const result = await commitImport(ctx, userId, eventId, batchId);
    expect(result).toMatchObject({ imported: 2, skipped: 3 });
    const phones = await listGuests(ctx, userId, eventId, { q: '0551234567', sort: 'name' });
    expect(phones.rows.map((r) => r.fullName)).toEqual(['أحمد', 'محمد']);
    const created = await ctx.db
      .select({ data: activity.data })
      .from(activity)
      .where(
        and(
          eq(activity.eventId, eventId),
          eq(activity.type, 'guest.created'),
          sql`${activity.data}->>'source' = 'excel_import'`,
        ),
      );
    expect(
      created
        .map((c) => (c.data as { duplicateAcknowledged: boolean }).duplicateAcknowledged)
        .sort(),
    ).toEqual([false, true]);
  });

  it('links existing groups by name, ignoring case and spaces, and creates each new one once', async () => {
    const { userId, eventId, upload } = await setup();
    const { groupId } = await createGroup(ctx, userId, eventId, { name: 'Family' });
    const { batchId } = await upload([
      TEMPLATE_ROW,
      ['أ', '0551000001', '', ' family '],
      ['ب', '0551000002', '', 'أصدقاء  العمل'],
      ['ج', '0551000003', '', 'أصدقاء العمل'],
      ['د', '0551000004', '', 'مجموعة متروكة'],
    ]);
    const rows = await rowsOf(batchId);
    expect(
      rows.map((r) => (r.issues as { code: string }[]).some((i) => i.code === 'new_group')),
    ).toEqual([false, true, true, true]);
    await setImportDecisions(ctx, userId, eventId, batchId, { rowIds: [rows[3]!.id] }, 'skip');
    expect((await getImportBatch(ctx, userId, eventId, batchId)).newGroups).toBe(1);
    expect(await commitImport(ctx, userId, eventId, batchId)).toMatchObject({
      imported: 3,
      groupsCreated: 1,
    });
    const groups = await listGroups(ctx, userId, eventId);
    // A group only named by a skipped row is not created.
    expect(groups.map((g) => [g.name, g.guestCount])).toEqual([
      ['Family', 1],
      ['أصدقاء العمل', 2],
    ]);
    expect((await listGuests(ctx, userId, eventId, { group: groupId })).rows[0]!.fullName).toBe(
      'أ',
    );
  });

  it('re-checks at commit: a guest added during review sends the row back for a decision', async () => {
    const { userId, eventId, upload } = await setup();
    const { batchId } = await upload([TEMPLATE_ROW, ['نورة', '0552000001'], ['هند', '0552000002']]);
    await addGuest(ctx, userId, eventId, { fullName: 'نوره', phone: '0552000001' });
    expect(await commitImport(ctx, userId, eventId, batchId)).toEqual({
      status: 'changed',
      rowsChanged: 1,
    });
    expect((await guestSummary(ctx, userId, eventId)).total).toBe(1);
    const batch = await getImportBatch(ctx, userId, eventId, batchId);
    expect(batch).toMatchObject({ status: 'parsed', readyCount: 1, reviewCount: 1 });
    // Same name after normalization (ة/ه): starts as skip, so the commit can go ahead.
    expect(batch.undecided).toBe(0);
    expect(await commitImport(ctx, userId, eventId, batchId)).toMatchObject({
      status: 'committed',
      imported: 1,
      skipped: 1,
    });
  });

  it('fails a file without the required headers, naming them', async () => {
    const { userId, eventId, upload } = await setup();
    const { batchId, status } = await upload([
      ['الاسم', 'المدينة'],
      ['أحمد', 'الرياض'],
    ]);
    expect(status).toBe('failed');
    const batch = await getImportBatch(ctx, userId, eventId, batchId);
    expect(batch).toMatchObject({
      errorCode: 'missing_headers',
      errorDetail: { missing: ['phone'], found: ['الاسم', 'المدينة'] },
    });
    await expect(commitImport(ctx, userId, eventId, batchId)).rejects.toEqual(
      code('import_not_ready'),
    );
  });

  it('fails unreadable, empty and oversized files with a reason', async () => {
    const { userId, eventId } = await setup();
    const up = (bytes: Uint8Array) => createImportBatch(ctx, userId, eventId, { name: 'x', bytes });
    const reason = async (bytes: Uint8Array) => {
      const { batchId } = await up(bytes);
      return (await getImportBatch(ctx, userId, eventId, batchId)).errorCode;
    };
    expect(await reason(excelLikeXlsx([TEMPLATE_ROW], { macro: true }))).toBe('file_macro');
    expect(await reason(excelLikeXlsx([TEMPLATE_ROW]))).toBe('file_empty');
    expect(await reason(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(
      'file_legacy_xls',
    );
    expect(await reason(new Uint8Array([1, 0, 2, 0]))).toBe('file_unsupported');
    const tooMany = [TEMPLATE_ROW, ...guestRows(5001)];
    expect(await reason(excelLikeXlsx(tooMany))).toBe('too_many_rows');
  });

  it('reads CSV and ignores blank rows and extra columns', async () => {
    const { userId, eventId } = await setup();
    const csv = 'الاسم,الجوال,رقم الطاولة\nريم,0553000001,4\n,,\nلمى,0553000002,5\n';
    const { batchId } = await createImportBatch(ctx, userId, eventId, {
      name: 'list.csv',
      bytes: strToU8(csv),
    });
    const batch = await getImportBatch(ctx, userId, eventId, batchId);
    expect(batch).toMatchObject({
      status: 'parsed',
      rowCount: 2,
      errorDetail: { ignoredColumns: ['رقم الطاولة'] },
    });
    expect((await rowsOf(batchId)).map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it('returns the open review when the same file is uploaded twice; discard removes staged rows', async () => {
    const { userId, eventId } = await setup();
    const bytes = excelLikeXlsx([TEMPLATE_ROW, ...guestRows(3)]);
    const a = await createImportBatch(ctx, userId, eventId, { name: 'a.xlsx', bytes });
    const b = await createImportBatch(ctx, userId, eventId, { name: 'a.xlsx', bytes });
    expect(b.batchId).toBe(a.batchId);
    expect(await discardImport(ctx, userId, eventId, a.batchId)).toEqual({ changed: true });
    expect(await rowsOf(a.batchId)).toHaveLength(0);
    await expect(commitImport(ctx, userId, eventId, a.batchId)).rejects.toEqual(
      code('import_not_ready'),
    );
    const c = await createImportBatch(ctx, userId, eventId, { name: 'a.xlsx', bytes });
    expect(c.batchId).not.toBe(a.batchId);
  });

  it('imports 500 rows and a following import of 320 with overlaps in one commit each', async () => {
    const { userId, eventId, upload } = await setup();
    const first = await upload([TEMPLATE_ROW, ...guestRows(500)]);
    const t0 = Date.now();
    expect(await commitImport(ctx, userId, eventId, first.batchId)).toMatchObject({
      imported: 500,
    });
    const commitMs = Date.now() - t0;
    expect(commitMs).toBeLessThan(10_000);
    // Rows 480–799: 20 overlap with guests already imported (same names too: start as skip).
    const second = await upload([TEMPLATE_ROW, ...guestRows(320, 480)]);
    const batch = await getImportBatch(ctx, userId, eventId, second.batchId);
    expect(batch).toMatchObject({ rowCount: 320, readyCount: 300, reviewCount: 20, undecided: 0 });
    expect(await commitImport(ctx, userId, eventId, second.batchId)).toMatchObject({
      imported: 300,
      skipped: 20,
    });
    expect((await guestSummary(ctx, userId, eventId)).total).toBe(800);
  });

  it('staff and other owners cannot import', async () => {
    const { eventId } = await setup();
    const stranger = await createOwner(ctx);
    await expect(
      createImportBatch(ctx, stranger.userId, eventId, {
        name: 'x',
        bytes: excelLikeXlsx([TEMPLATE_ROW]),
      }),
    ).rejects.toEqual(code('not_found'));
  });

  it('purges staged rows 30 days after a batch is finished', async () => {
    const { userId, eventId, upload } = await setup();
    const { batchId } = await upload([TEMPLATE_ROW, ...guestRows(2)]);
    await commitImport(ctx, userId, eventId, batchId);
    await ctx.db
      .update(importBatches)
      .set({ updatedAt: new Date(ctx.now().getTime() - 31 * 86_400_000) })
      .where(eq(importBatches.id, batchId));
    expect(await purgeImportRows(ctx.db, ctx.now())).toBeGreaterThanOrEqual(2);
    expect(await rowsOf(batchId)).toHaveLength(0);
    // Guests remain; their link to the purged row is cleared.
    expect((await guestSummary(ctx, userId, eventId)).total).toBe(2);
  });
});
