import { activity, eventMemberships, guests } from '@gp/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEvent, transitionEvent } from '../events/events';
import { newId } from '../shared/ids';
import { createOwner, createTestContext, databaseUrl, eventInput } from '../testing/harness';
import { createGroup, deleteGroup, listGroups, moveGroup, renameGroup } from './groups';
import {
  addGuest,
  bulkAssignGroup,
  bulkCancel,
  bulkSetCompanions,
  cancelGuest,
  deleteGuest,
  getGuest,
  guestSummary,
  listGuestActivity,
  listGuests,
  restoreGuest,
  updateGuest,
} from './guests';

const code = (c: string) => expect.objectContaining({ code: c });
const fields = (f: Record<string, string>, c = 'validation_failed') =>
  expect.objectContaining({ code: c, details: { fields: f } });
const nameTaken = fields({ name: 'group_name_taken' }, 'group_name_taken');

describe.skipIf(!databaseUrl)('guests', () => {
  const ctx = createTestContext(new Date('2033-01-01T09:00:00Z'));

  async function setup() {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    const add = async (input: Record<string, unknown>) => {
      const r = await addGuest(ctx, owner.userId, eventId, input);
      if (r.status !== 'saved') throw new Error('unexpected duplicate');
      return r.guestId;
    };
    return { owner, userId: owner.userId, eventId, add };
  }

  async function activityOf(guestId: string) {
    return ctx.db
      .select({ type: activity.type, data: activity.data })
      .from(activity)
      .where(eq(activity.guestId, guestId))
      .orderBy(activity.id);
  }

  it('adds a guest with a normalized phone, search name and event default companions', async () => {
    const { userId, eventId, add } = await setup();
    const id = await add({ fullName: '  أحمد   إبراهيم ', phone: '0551234567', notes: 'VIP' });
    const g = await getGuest(ctx, userId, eventId, id);
    expect(g).toMatchObject({
      fullName: 'أحمد إبراهيم',
      nameSearch: 'احمد ابراهيم',
      phoneOriginal: '0551234567',
      phoneE164: '+966551234567',
      allowedCompanions: 2,
      source: 'manual',
      status: 'active',
      groupId: null,
      notes: 'VIP',
    });
    expect(await activityOf(id)).toEqual([
      { type: 'guest.created', data: { source: 'manual', duplicateAcknowledged: false } },
    ]);
  });

  it('explains what is wrong with a phone or other field', async () => {
    const { userId, eventId } = await setup();
    const tryAdd = (input: Record<string, unknown>) => addGuest(ctx, userId, eventId, input);
    await expect(tryAdd({ fullName: 'x' })).rejects.toEqual(fields({ phone: 'missing_phone' }));
    await expect(tryAdd({ fullName: 'x', phone: '12345' })).rejects.toEqual(
      fields({ phone: 'invalid_phone' }),
    );
    await expect(tryAdd({ fullName: 'x', phone: '0551234567 / 0501234567' })).rejects.toEqual(
      fields({ phone: 'unsupported_phone' }),
    );
    await expect(tryAdd({ fullName: '', phone: '0551234567' })).rejects.toEqual(
      fields({ fullName: 'required' }),
    );
    await expect(
      tryAdd({ fullName: 'x', phone: '0551234567', email: 'nope', allowedCompanions: '21' }),
    ).rejects.toEqual(fields({ email: 'invalid_email', allowedCompanions: 'out_of_range' }));
    await expect(tryAdd({ fullName: 'x', phone: '0551234567', groupId: newId() })).rejects.toEqual(
      fields({ groupId: 'not_found' }),
    );
  });

  it('accepts international numbers', async () => {
    const { userId, eventId, add } = await setup();
    const id = await add({ fullName: 'John', phone: '+44 7911 123456' });
    expect((await getGuest(ctx, userId, eventId, id)).phoneE164).toBe('+447911123456');
  });

  it('warns on the same phone instead of blocking, and records "add anyway"', async () => {
    const { userId, eventId, add } = await setup();
    const { groupId } = await createGroup(ctx, userId, eventId, { name: 'العائلة' });
    const first = await add({ fullName: 'سارة', phone: '0501234567', groupId });
    const warn = await addGuest(ctx, userId, eventId, { fullName: 'نورة', phone: '+966501234567' });
    expect(warn).toEqual({
      status: 'duplicate',
      duplicates: [
        {
          id: first,
          fullName: 'سارة',
          phoneE164: '+966501234567',
          groupName: 'العائلة',
          status: 'active',
        },
      ],
    });
    const again = await addGuest(ctx, userId, eventId, {
      fullName: 'نورة',
      phone: '00966501234567',
      allowDuplicate: 'on',
    });
    expect(again.status).toBe('saved');
    if (again.status !== 'saved') return;
    expect(await activityOf(again.guestId)).toEqual([
      { type: 'guest.created', data: { source: 'manual', duplicateAcknowledged: true } },
    ]);
    expect((await guestSummary(ctx, userId, eventId)).total).toBe(2);
  });

  it('edits with activity naming fields, never values', async () => {
    const { userId, eventId, add } = await setup();
    const { groupId } = await createGroup(ctx, userId, eventId, { name: 'VIP' });
    const id = await add({ fullName: 'خالد', phone: '0551111111' });
    const same = await updateGuest(ctx, userId, eventId, id, {
      fullName: 'خالد',
      phone: '0551111111',
      allowedCompanions: '2',
    });
    expect(same).toMatchObject({ status: 'saved', changed: false });
    await updateGuest(ctx, userId, eventId, id, {
      fullName: 'خالد العتيبي',
      phone: '0551111111',
      email: 'k@example.sa',
      groupId,
      allowedCompanions: '4',
    });
    const log = await activityOf(id);
    expect(log.slice(1)).toEqual([
      { type: 'guest.updated', data: { fields: ['fullName', 'email'] } },
      { type: 'guest.group_changed', data: { from: null, to: groupId } },
      { type: 'guest.companion_allowance_changed', data: { from: 2, to: 4 } },
    ]);
    expect(JSON.stringify(log)).not.toContain('خالد');
    expect(JSON.stringify(log)).not.toContain('k@example.sa');
  });

  it("warns when an edit gives a guest another guest's phone", async () => {
    const { userId, eventId, add } = await setup();
    await add({ fullName: 'أ', phone: '0552222222' });
    const b = await add({ fullName: 'ب', phone: '0553333333' });
    const r = await updateGuest(ctx, userId, eventId, b, { fullName: 'ب', phone: '0552222222' });
    expect(r.status).toBe('duplicate');
    const ok = await updateGuest(ctx, userId, eventId, b, {
      fullName: 'ب',
      phone: '0552222222',
      allowDuplicate: 'true',
    });
    expect(ok).toMatchObject({ status: 'saved', changed: true });
  });

  it('cancels and restores without deleting; cancelled guests stay searchable', async () => {
    const { userId, eventId, add } = await setup();
    const id = await add({ fullName: 'منى', phone: '0554444444', allowedCompanions: '3' });
    expect(await cancelGuest(ctx, userId, eventId, id, { reason: 'اعتذرت' })).toEqual({
      changed: true,
    });
    expect(await cancelGuest(ctx, userId, eventId, id)).toEqual({ changed: false });
    const g = await getGuest(ctx, userId, eventId, id);
    expect(g).toMatchObject({ status: 'cancelled', cancelReason: 'اعتذرت' });
    expect(g.cancelledAt).toBeInstanceOf(Date);
    expect(await guestSummary(ctx, userId, eventId)).toEqual({
      total: 1,
      active: 0,
      cancelled: 1,
      potentialCapacity: 0,
    });
    expect((await listGuests(ctx, userId, eventId, { q: 'منى' })).total).toBe(1);

    await restoreGuest(ctx, userId, eventId, id);
    expect(await getGuest(ctx, userId, eventId, id)).toMatchObject({
      status: 'active',
      cancelledAt: null,
      cancelReason: null,
    });
    expect((await activityOf(id)).map((a) => a.type)).toEqual([
      'guest.created',
      'guest.cancelled',
      'guest.restored',
    ]);
    // The reason is for the owner; it doesn't go into activity.
    expect(JSON.stringify(await activityOf(id))).not.toContain('اعتذرت');
    expect((await guestSummary(ctx, userId, eventId)).potentialCapacity).toBe(4);
  });

  it('hard-deletes through the delete rule and keeps an id-only trace', async () => {
    const { userId, eventId, add } = await setup();
    const id = await add({ fullName: 'خطأ', phone: '0555555555' });
    await deleteGuest(ctx, userId, eventId, id);
    await expect(getGuest(ctx, userId, eventId, id)).rejects.toEqual(code('not_found'));
    const log = await activityOf(id);
    expect(log.map((a) => a.type)).toEqual(['guest.created', 'guest.deleted']);
    await expect(deleteGuest(ctx, userId, eventId, id)).rejects.toEqual(code('not_found'));
  });

  it('searches Arabic names across letter variants and phones by any digits', async () => {
    const { userId, eventId, add } = await setup();
    await add({ fullName: 'أحمد إبراهيم', phone: '0551234567' });
    await add({ fullName: 'مَريَم الحربي', phone: '+971501234567' });
    await add({ fullName: 'Sarah Smith', phone: '0509876543' });
    const names = async (q: string) =>
      (await listGuests(ctx, userId, eventId, { q, sort: 'name' })).rows.map((r) => r.fullName);
    expect(await names('احمد')).toEqual(['أحمد إبراهيم']);
    expect(await names('ابراهيم')).toEqual(['أحمد إبراهيم']);
    expect(await names('مريم')).toEqual(['مَريَم الحربي']);
    expect(await names('SARAH')).toEqual(['Sarah Smith']);
    expect(await names('0551')).toEqual(['أحمد إبراهيم']);
    expect(await names('+966 55 123')).toEqual(['أحمد إبراهيم']);
    expect(await names('٠٥٠٩٨٧')).toEqual(['Sarah Smith']);
    expect(await names('971')).toEqual(['مَريَم الحربي']);
    expect(await names('%')).toEqual([]);
  });

  it('composes status, group and source filters, sorts and paginates', async () => {
    const { userId, eventId, add } = await setup();
    const { groupId } = await createGroup(ctx, userId, eventId, { name: 'الأصدقاء' });
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      ids.push(
        await add({
          fullName: `ضيف ${String(i).padStart(2, '0')}`,
          phone: `05560000${String(i).padStart(2, '0')}`,
          ...(i % 2 ? { groupId } : {}),
        }),
      );
    }
    await cancelGuest(ctx, userId, eventId, ids[1]!);
    await cancelGuest(ctx, userId, eventId, ids[2]!);
    const q = (query: Record<string, unknown>) => listGuests(ctx, userId, eventId, query);
    expect((await q({ status: 'active', group: groupId })).total).toBe(5);
    expect((await q({ status: 'cancelled', group: 'none' })).total).toBe(1);
    expect((await q({ source: 'excel_import' })).total).toBe(0);
    expect((await q({ source: 'manual', status: 'bogus' })).total).toBe(12);
    const page = await q({ pageSize: '25', sort: 'name' });
    expect(page.rows[0]!.fullName).toBe('ضيف 00');
    const p2 = await listGuests(ctx, userId, eventId, { pageSize: 25, page: 9 });
    expect(p2).toMatchObject({ page: 1, pages: 1 });
    const first = await q({ sort: 'recent' });
    expect(first.rows[0]!.id).toBe(ids[11]);
    expect(first.rows.find((r) => r.id === ids[1])).toMatchObject({
      groupName: 'الأصدقاء',
      status: 'cancelled',
    });
  });

  it('bulk-assigns groups, changes companions and cancels, transactionally', async () => {
    const { userId, eventId, add } = await setup();
    const { groupId } = await createGroup(ctx, userId, eventId, { name: 'الطاولة ١' });
    const a = await add({ fullName: 'أ', phone: '0557000001' });
    const b = await add({ fullName: 'ب', phone: '0557000002' });
    const c = await add({ fullName: 'ج', phone: '0557000003', groupId });
    expect(await bulkAssignGroup(ctx, userId, eventId, [a, b, c], groupId)).toEqual({
      selected: 3,
      changed: 2,
    });
    expect(await bulkSetCompanions(ctx, userId, eventId, [a, b], '0')).toEqual({
      selected: 2,
      changed: 2,
    });
    await expect(bulkSetCompanions(ctx, userId, eventId, [a], '30')).rejects.toEqual(
      code('validation_failed'),
    );
    expect(await bulkCancel(ctx, userId, eventId, [a, c], { reason: '' })).toEqual({
      selected: 2,
      changed: 2,
    });
    expect(await guestSummary(ctx, userId, eventId)).toMatchObject({
      active: 1,
      cancelled: 2,
      potentialCapacity: 1,
    });

    // A guest of another event in the selection aborts the whole action.
    const other = await setup();
    const foreign = await other.add({ fullName: 'د', phone: '0557000004' });
    await expect(bulkAssignGroup(ctx, userId, eventId, [b, foreign], null)).rejects.toEqual(
      code('not_found'),
    );
    expect((await getGuest(ctx, userId, eventId, b)).groupId).toBe(groupId);
    await expect(
      bulkCancel(
        ctx,
        userId,
        eventId,
        Array.from({ length: 501 }, () => newId()),
      ),
    ).rejects.toEqual(code('too_many_selected'));
  });

  it("pages a guest's activity newest first", async () => {
    const { userId, eventId, add } = await setup();
    const id = await add({ fullName: 'ه', phone: '0558000000' });
    for (let i = 0; i < 3; i++) {
      await cancelGuest(ctx, userId, eventId, id);
      await restoreGuest(ctx, userId, eventId, id);
    }
    const p1 = await listGuestActivity(ctx, userId, eventId, id, { limit: 4 });
    expect(p1.more).toBe(true);
    expect(p1.items.map((i) => i.type)).toEqual([
      'guest.restored',
      'guest.cancelled',
      'guest.restored',
      'guest.cancelled',
    ]);
    expect(p1.items[0]!.byName).toBeTruthy();
    const p2 = await listGuestActivity(ctx, userId, eventId, id, {
      limit: 4,
      before: p1.items.at(-1)!.id,
    });
    expect(p2).toMatchObject({ more: false });
    expect(p2.items.map((i) => i.type)).toEqual([
      'guest.restored',
      'guest.cancelled',
      'guest.created',
    ]);
  });

  it('keeps guests read-only once the event is completed, cancelled or archived', async () => {
    const { userId, eventId, add } = await setup();
    const id = await add({ fullName: 'و', phone: '0559000000' });
    await transitionEvent(ctx, userId, eventId, 'activate');
    await add({ fullName: 'ز', phone: '0559000002' });
    await transitionEvent(ctx, userId, eventId, 'cancel', { reason: 'تأجيل' });
    await expect(add({ fullName: 'ز', phone: '0559000001' })).rejects.toEqual(
      code('event_not_editable'),
    );
    await expect(cancelGuest(ctx, userId, eventId, id)).rejects.toEqual(code('event_not_editable'));
    expect((await listGuests(ctx, userId, eventId)).total).toBe(2);
  });

  it('enforces the guest rules in the database too', async () => {
    const { owner, add } = await setup();
    const id = await add({ fullName: 'ح', phone: '0559100000' });
    const other = await createEvent(ctx, owner.userId, eventInput(ctx));
    await expect(
      ctx.db.update(guests).set({ eventId: other.eventId }).where(eq(guests.id, id)),
    ).rejects.toThrow();
    await expect(
      ctx.db.update(guests).set({ phoneE164: null }).where(eq(guests.id, id)),
    ).rejects.toThrow();
    await expect(
      ctx.db.update(guests).set({ status: 'cancelled' }).where(eq(guests.id, id)),
    ).rejects.toThrow();
    await expect(
      ctx.db.update(guests).set({ allowedCompanions: 21 }).where(eq(guests.id, id)),
    ).rejects.toThrow();
  });

  describe('groups', () => {
    it('creates, renames and reorders; names are unique ignoring case and spaces', async () => {
      const { userId, eventId } = await setup();
      const a = await createGroup(ctx, userId, eventId, { name: ' Family ' });
      const b = await createGroup(ctx, userId, eventId, { name: 'العمل' });
      await expect(createGroup(ctx, userId, eventId, { name: 'family' })).rejects.toEqual(
        nameTaken,
      );
      await expect(createGroup(ctx, userId, eventId, { name: '   ' })).rejects.toEqual(
        fields({ name: 'required' }),
      );
      await expect(
        renameGroup(ctx, userId, eventId, b.groupId, { name: 'FAMILY' }),
      ).rejects.toEqual(nameTaken);
      expect(await renameGroup(ctx, userId, eventId, a.groupId, { name: 'العائلة' })).toEqual({
        changed: true,
      });
      await moveGroup(ctx, userId, eventId, b.groupId, 'up');
      expect((await listGroups(ctx, userId, eventId)).map((g) => g.name)).toEqual([
        'العمل',
        'العائلة',
      ]);
      expect(await moveGroup(ctx, userId, eventId, b.groupId, 'up')).toEqual({ changed: false });
      // Another event may use the same name.
      const other = await setup();
      await createGroup(ctx, other.userId, other.eventId, { name: 'العائلة' });
    });

    it('deleting a group keeps its guests, ungrouped, with timeline entries', async () => {
      const { userId, eventId, add } = await setup();
      const { groupId } = await createGroup(ctx, userId, eventId, { name: 'مؤقت' });
      const id = await add({ fullName: 'ط', phone: '0559200000', groupId });
      expect((await listGroups(ctx, userId, eventId))[0]).toMatchObject({ guestCount: 1 });
      expect(await deleteGroup(ctx, userId, eventId, groupId)).toEqual({ guestsUngrouped: 1 });
      expect(await getGuest(ctx, userId, eventId, id)).toMatchObject({
        groupId: null,
        status: 'active',
      });
      expect((await activityOf(id)).at(-1)).toEqual({
        type: 'guest.group_changed',
        data: { from: groupId, to: null, reason: 'group_deleted' },
      });
    });
  });

  describe('access', () => {
    it('denies staff, other owners and cross-event group use', async () => {
      const { userId, eventId, add } = await setup();
      const id = await add({ fullName: 'ي', phone: '0559300000' });
      const staffUser = await createOwner(ctx);
      await ctx.db.insert(eventMemberships).values({
        id: newId(),
        eventId,
        userId: staffUser.userId,
        role: 'staff',
        displayName: 'موظف',
        status: 'active',
      });
      const stranger = await createOwner(ctx);
      for (const [who, expected] of [
        [staffUser.userId, 'forbidden'],
        [stranger.userId, 'not_found'],
      ] as const) {
        for (const attempt of [
          () => listGuests(ctx, who, eventId),
          () => getGuest(ctx, who, eventId, id),
          () => addGuest(ctx, who, eventId, { fullName: 'x', phone: '0551234567' }),
          () => cancelGuest(ctx, who, eventId, id),
          () => createGroup(ctx, who, eventId, { name: 'x' }),
          () => listGroups(ctx, who, eventId),
        ]) {
          await expect(attempt()).rejects.toEqual(code(expected));
        }
      }
      // A guest id from one event can't be reached through another event the caller owns.
      const mine = await createEvent(ctx, userId, eventInput(ctx));
      await expect(getGuest(ctx, userId, mine.eventId, id)).rejects.toEqual(code('not_found'));
      await expect(cancelGuest(ctx, userId, mine.eventId, id)).rejects.toEqual(code('not_found'));
      const foreignGroup = await createGroup(ctx, userId, mine.eventId, { name: 'خارجي' });
      await expect(
        addGuest(ctx, userId, eventId, {
          fullName: 'x',
          phone: '0551234567',
          groupId: foreignGroup.groupId,
        }),
      ).rejects.toEqual(fields({ groupId: 'not_found' }));
      const count = await ctx.db
        .select({ n: sql<number>`count(*)`.mapWith(Number) })
        .from(guests)
        .where(and(eq(guests.eventId, eventId)));
      expect(count[0]!.n).toBe(1);
    });
  });
});
