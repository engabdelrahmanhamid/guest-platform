import { randomUUID } from 'node:crypto';
import { attendance, checkInLogs, guestPasses, guests, rsvps } from '@gp/db/schema';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEvent, transitionEvent } from '../events/events';
import { addGuest, bulkCancel, cancelGuest, listGuests } from '../guests/guests';
import { invitationToken } from '../lifecycle/invitations';
import { passToken } from '../lifecycle/passes';
import { replaceGuestPass, respondToInvitation, setGuestRsvp } from '../lifecycle/rsvp';
import { addStaff, removeStaff } from '../memberships/memberships';
import { createOwner, createTestContext, databaseUrl, eventInput } from '../testing/harness';
import {
  attendanceSummary,
  getDoorOverview,
  getGuestAttendance,
  getLiveAttendance,
} from './attendance';
import {
  checkIn,
  confirmAtDoor,
  correctAttendance,
  lookupQr,
  parseQrPayload,
  registerWalkIn,
  searchDoor,
} from './checkin';
import type { DoorCaller } from './door';
import {
  getStaffLink,
  listDoorTeam,
  listTeamAccess,
  redeemStaffLink,
  revokeStaffAccess,
  sendStaffAccess,
} from './staff-access';
import { invitations } from '@gp/db/schema';

const code = (c: string) => expect.objectContaining({ code: c });
const key = () => randomUUID();

describe('QR payloads', () => {
  it('accepts only GP1.<token>', () => {
    expect(parseQrPayload('GP1.abcdefghijABCDEFGHIJ12')).toBe('abcdefghijABCDEFGHIJ12');
    expect(parseQrPayload(' GP1.abcdefghijABCDEFGHIJ12 ')).toBe('abcdefghijABCDEFGHIJ12');
    expect(parseQrPayload('https://example.com/i/abcdefghijABCDEFGHIJ12')).toBeNull();
    expect(parseQrPayload('GP1.short')).toBeNull();
    expect(parseQrPayload('GP2.abcdefghijABCDEFGHIJ12')).toBeNull();
  });
});

describe.skipIf(!databaseUrl)('check-in', () => {
  const ctx = createTestContext(new Date('2035-03-01T15:00:00Z'));

  async function setup(opts: { live?: boolean } = {}) {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(
      ctx,
      owner.userId,
      eventInput(ctx, { defaultAllowedCompanions: '3' }),
    );
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    if (opts.live !== false) await transitionEvent(ctx, owner.userId, eventId, 'start');
    const ownerCaller: DoorCaller = { kind: 'owner', userId: owner.userId };

    /** A guest who confirmed with `companions`; returns ids, their link and their QR. */
    const guest = async (companions: number | null = 2, input: Record<string, unknown> = {}) => {
      const r = await addGuest(ctx, owner.userId, eventId, {
        fullName: 'سارة القحطاني',
        phone: `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        ...input,
      });
      if (r.status !== 'saved') throw new Error('duplicate');
      const [inv] = await ctx.db
        .select()
        .from(invitations)
        .where(eq(invitations.guestId, r.guestId));
      const link = invitationToken(inv!, ctx.encryptionKey);
      if (companions === null) return { guestId: r.guestId, link, passId: null, qr: null };
      const { pass } = await setGuestRsvp(ctx, owner.userId, eventId, r.guestId, {
        status: 'confirmed',
        companions,
      });
      return {
        guestId: r.guestId,
        link,
        passId: pass!.id,
        qr: `GP1.${passToken(pass!, ctx.encryptionKey)}`,
      };
    };

    /** A staff member signed in on a device through their access link. */
    const staff = async (isSupervisor = false) => {
      const { membershipId } = await addStaff(ctx, owner.userId, eventId, {
        displayName: isSupervisor ? 'فهد' : 'خالد',
        isSupervisor: isSupervisor ? 'on' : undefined,
      });
      const { url } = await sendStaffAccess(ctx, ownerCaller, eventId, membershipId);
      const token = url.split('/s/')[1]!;
      const { sessionToken } = await redeemStaffLink(ctx, token, 'iPhone · Safari');
      return { membershipId, caller: { kind: 'staff', sessionToken } as DoorCaller, token };
    };

    return { owner, eventId, ownerCaller, guest, staff };
  }

  describe('staff access', () => {
    it('opens a link without using it, then redeems it once on one device', async () => {
      const { owner, eventId, ownerCaller } = await setup();
      const { membershipId } = await addStaff(ctx, owner.userId, eventId, { displayName: 'خالد' });
      const { url } = await sendStaffAccess(ctx, ownerCaller, eventId, membershipId);
      const token = url.split('/s/')[1]!;
      expect(url).toMatch(/^http:\/\/localhost:3000\/s\/[A-Za-z0-9_-]{22}$/);

      // Viewing (and a link preview) never redeems.
      expect(await getStaffLink(ctx, token)).toMatchObject({ state: 'ready', staffName: 'خالد' });
      expect(await getStaffLink(ctx, token)).toMatchObject({ state: 'ready' });

      const { sessionToken } = await redeemStaffLink(ctx, token, 'Android · Chrome');
      const overview = await getDoorOverview(ctx, { kind: 'staff', sessionToken }, eventId);
      expect(overview.member).toEqual({ name: 'خالد', role: 'staff', isSupervisor: false });
      expect(overview.can).toEqual({
        correct: false,
        walkIn: false,
        confirm: false,
        manageAccess: false,
      });

      // A second device (or a forwarded link) gets nothing, and learns nothing.
      await expect(redeemStaffLink(ctx, token, 'other')).rejects.toEqual(
        code('staff_link_invalid'),
      );
      expect(await getStaffLink(ctx, token)).toEqual({
        state: 'used',
        eventName: null,
        staffName: null,
        isSupervisor: false,
      });
      const team = await listTeamAccess(ctx, owner.userId, eventId);
      expect(team[0]).toMatchObject({ status: 'active', linkPendingSince: null });
      expect(team[0]!.devices.map((d) => d.label)).toEqual(['Android · Chrome']);
    });

    it('resending signs the old device out; revoking and removing end access at once', async () => {
      const { eventId, ownerCaller, staff, owner } = await setup();
      const k = await staff();
      await getDoorOverview(ctx, k.caller, eventId);
      const { url } = await sendStaffAccess(ctx, ownerCaller, eventId, k.membershipId);
      await expect(getDoorOverview(ctx, k.caller, eventId)).rejects.toEqual(
        code('staff_session_invalid'),
      );
      const { sessionToken } = await redeemStaffLink(ctx, url.split('/s/')[1]!, 'new phone');
      const fresh: DoorCaller = { kind: 'staff', sessionToken };
      await getDoorOverview(ctx, fresh, eventId);

      await revokeStaffAccess(ctx, ownerCaller, eventId, k.membershipId);
      await expect(getDoorOverview(ctx, fresh, eventId)).rejects.toEqual(
        code('staff_session_invalid'),
      );

      const other = await staff();
      await removeStaff(ctx, owner.userId, eventId, other.membershipId);
      await expect(getDoorOverview(ctx, other.caller, eventId)).rejects.toEqual(
        code('staff_session_invalid'),
      );
    });

    it('lets supervisors resend links but not plain staff', async () => {
      const { eventId, staff } = await setup();
      const sup = await staff(true);
      const plain = await staff();
      await expect(sendStaffAccess(ctx, plain.caller, eventId, sup.membershipId)).rejects.toEqual(
        code('forbidden'),
      );
      const r = await sendStaffAccess(ctx, sup.caller, eventId, plain.membershipId);
      expect(r.resent).toBe(true);
    });

    it('stops staff sessions when check-in ends and brings them back on reopen', async () => {
      const { owner, eventId, staff } = await setup();
      const k = await staff();
      await transitionEvent(ctx, owner.userId, eventId, 'complete');
      await expect(getDoorOverview(ctx, k.caller, eventId)).rejects.toEqual(
        code('staff_session_invalid'),
      );
      await transitionEvent(ctx, owner.userId, eventId, 'reopen');
      expect((await getDoorOverview(ctx, k.caller, eventId)).event.status).toBe('live');
    });

    it('scopes a staff session to its own event', async () => {
      const a = await setup();
      const b = await setup();
      const k = await a.staff();
      await expect(getDoorOverview(ctx, k.caller, b.eventId)).rejects.toEqual(
        code('staff_session_invalid'),
      );
    });
  });

  describe('scanning and checking in', () => {
    it('admits a party in parts, then refuses more than expected', async () => {
      const { eventId, guest, staff } = await setup();
      const g = await guest(2);
      const k = await staff();
      const found = await lookupQr(ctx, k.caller, eventId, g.qr!);
      expect(found).toMatchObject({
        found: true,
        guest: {
          expected: 3,
          checkedIn: 0,
          remaining: 3,
          blocker: null,
          attendance: 'not_arrived',
        },
      });
      // Staff never see the full phone.
      if (found.found) expect(found.guest.maskedPhone).toMatch(/^•••• \d{4}$/);

      const first = await checkIn(ctx, k.caller, eventId, {
        guestId: g.guestId,
        count: 2,
        method: 'qr',
        passId: g.passId,
        idempotencyKey: key(),
      });
      expect(first.guest).toMatchObject({ checkedIn: 2, remaining: 1, attendance: 'partial' });
      await expect(
        checkIn(ctx, k.caller, eventId, {
          guestId: g.guestId,
          count: 2,
          method: 'qr',
          passId: g.passId,
          idempotencyKey: key(),
        }),
      ).rejects.toEqual(
        expect.objectContaining({ code: 'count_over_remaining', details: { remaining: 1 } }),
      );
      await checkIn(ctx, k.caller, eventId, {
        guestId: g.guestId,
        count: 1,
        method: 'search',
        idempotencyKey: key(),
      });
      const again = await lookupQr(ctx, k.caller, eventId, g.qr!);
      expect(again).toMatchObject({
        guest: { checkedIn: 3, blocker: 'party_complete', last: { by: 'خالد', count: 1 } },
      });
      await expect(
        checkIn(ctx, k.caller, eventId, {
          guestId: g.guestId,
          count: 1,
          method: 'search',
          idempotencyKey: key(),
        }),
      ).rejects.toEqual(code('party_complete'));
    });

    it('replays a retried request instead of counting it twice', async () => {
      const { eventId, guest, ownerCaller } = await setup();
      const g = await guest(1);
      const k = key();
      const input = {
        guestId: g.guestId,
        count: 1,
        method: 'qr',
        passId: g.passId,
        idempotencyKey: k,
      };
      const a = await checkIn(ctx, ownerCaller, eventId, input);
      const b = await checkIn(ctx, ownerCaller, eventId, input);
      expect(a.replayed).toBe(false);
      expect(b.replayed).toBe(true);
      expect(b.guest.checkedIn).toBe(1);
      const other = await guest(1);
      await expect(
        checkIn(ctx, ownerCaller, eventId, {
          ...input,
          guestId: other.guestId,
          passId: other.passId,
        }),
      ).rejects.toEqual(code('idempotency_conflict'));
    });

    it('serializes two scanners on the same party', async () => {
      const { eventId, guest, staff } = await setup();
      const g = await guest(3);
      const [a, b] = [await staff(), await staff()];
      const results = await Promise.allSettled(
        [a, b].map((s) =>
          checkIn(ctx, s.caller, eventId, {
            guestId: g.guestId,
            count: 3,
            method: 'qr',
            passId: g.passId,
            idempotencyKey: key(),
          }),
        ),
      );
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { code: 'count_over_remaining' },
      });
      const [att] = await ctx.db.select().from(attendance).where(eq(attendance.guestId, g.guestId));
      expect(att?.checkedInCount).toBe(3);
    });

    it('applies one of many concurrent retries with the same key', async () => {
      const { eventId, guest, ownerCaller } = await setup();
      const g = await guest(3);
      const input = { guestId: g.guestId, count: 1, method: 'search', idempotencyKey: key() };
      const results = await Promise.all(
        Array.from({ length: 5 }, () => checkIn(ctx, ownerCaller, eventId, input)),
      );
      expect(results.filter((r) => !r.replayed)).toHaveLength(1);
      const rows = await ctx.db
        .select()
        .from(checkInLogs)
        .where(eq(checkInLogs.guestId, g.guestId));
      expect(rows).toHaveLength(1);
    });

    it('reads a pass from another event, or a replaced pass, for what it is', async () => {
      const a = await setup();
      const b = await setup();
      const g = await b.guest(1);
      expect(await lookupQr(ctx, a.ownerCaller, a.eventId, g.qr!)).toEqual({ found: false });
      expect(await lookupQr(ctx, a.ownerCaller, a.eventId, 'hello')).toEqual({ found: false });

      await replaceGuestPass(ctx, b.owner.userId, b.eventId, g.guestId);
      const old = await lookupQr(ctx, b.ownerCaller, b.eventId, g.qr!);
      expect(old).toMatchObject({
        found: true,
        guest: { blocker: 'pass_revoked', scannedPass: { status: 'revoked', replaced: true } },
      });
      await expect(
        checkIn(ctx, b.ownerCaller, b.eventId, {
          guestId: g.guestId,
          count: 1,
          method: 'qr',
          passId: g.passId,
          idempotencyKey: key(),
        }),
      ).rejects.toEqual(code('pass_revoked'));
    });

    it('refuses before check-in opens, and for unanswered or declined guests', async () => {
      const early = await setup({ live: false });
      const g0 = await early.guest(0);
      const view = await lookupQr(ctx, early.ownerCaller, early.eventId, g0.qr!);
      expect(view).toMatchObject({ guest: { blocker: 'checkin_not_open' } });
      await expect(
        checkIn(ctx, early.ownerCaller, early.eventId, {
          guestId: g0.guestId,
          count: 1,
          method: 'search',
          idempotencyKey: key(),
        }),
      ).rejects.toEqual(code('checkin_not_open'));

      const { eventId, guest, ownerCaller, owner } = await setup();
      const pending = await guest(null);
      await expect(
        checkIn(ctx, ownerCaller, eventId, {
          guestId: pending.guestId,
          count: 1,
          method: 'search',
          idempotencyKey: key(),
        }),
      ).rejects.toEqual(code('not_confirmed'));
      const declined = await guest(0);
      await setGuestRsvp(ctx, owner.userId, eventId, declined.guestId, { status: 'declined' });
      await expect(
        checkIn(ctx, ownerCaller, eventId, {
          guestId: declined.guestId,
          count: 1,
          method: 'search',
          idempotencyKey: key(),
        }),
      ).rejects.toEqual(code('rsvp_declined'));
    });

    it('finds guests by name or phone digits and masks the phone', async () => {
      const { eventId, guest, staff } = await setup();
      await guest(0, { fullName: 'عبدالله الزهراني', phone: '0551234567' });
      const k = await staff();
      const byName = await searchDoor(ctx, k.caller, eventId, 'الزهراني');
      expect(byName).toHaveLength(1);
      expect(byName[0]).toMatchObject({ maskedPhone: '•••• 4567', expected: 1 });
      expect(JSON.stringify(byName)).not.toContain('551234567');
      expect(await searchDoor(ctx, k.caller, eventId, '4567')).toHaveLength(1);
      expect(await searchDoor(ctx, k.caller, eventId, 'x')).toEqual([]);
    });
  });

  describe('supervisors and the owner', () => {
    it('corrects counts with a reason; staff cannot', async () => {
      const { eventId, guest, staff, owner } = await setup();
      const g = await guest(2);
      const plain = await staff();
      const sup = await staff(true);
      await checkIn(ctx, plain.caller, eventId, {
        guestId: g.guestId,
        count: 3,
        method: 'search',
        idempotencyKey: key(),
      });
      await expect(
        correctAttendance(ctx, plain.caller, eventId, {
          guestId: g.guestId,
          delta: -1,
          reason: 'x',
          idempotencyKey: key(),
        }),
      ).rejects.toEqual(code('forbidden'));
      await expect(
        correctAttendance(ctx, sup.caller, eventId, {
          guestId: g.guestId,
          delta: -1,
          reason: '',
          idempotencyKey: key(),
        }),
      ).rejects.toEqual(code('validation_failed'));
      const fixed = await correctAttendance(ctx, sup.caller, eventId, {
        guestId: g.guestId,
        delta: -2,
        reason: 'سُجّل مرتين بالخطأ',
        idempotencyKey: key(),
      });
      expect(fixed.guest).toMatchObject({ checkedIn: 1, attendance: 'partial' });
      await expect(
        correctAttendance(ctx, sup.caller, eventId, {
          guestId: g.guestId,
          delta: -2,
          reason: 'خطأ',
          idempotencyKey: key(),
        }),
      ).rejects.toEqual(code('correction_out_of_range'));

      const history = await getGuestAttendance(ctx, owner.userId, eventId, g.guestId);
      expect(history.history.map((h) => [h.action, h.delta, h.resulting, h.by])).toEqual([
        ['correction', -2, 1, 'فهد'],
        ['check_in', 3, 3, 'خالد'],
      ]);
      expect(history.history[0]!.reason).toBe('سُجّل مرتين بالخطأ');
      expect(history.history[1]!.device).toBe('iPhone · Safari');
    });

    it('lets the owner correct after the event ends, within the reopen window only', async () => {
      const { eventId, guest, ownerCaller, owner } = await setup();
      const g = await guest(1);
      await checkIn(ctx, ownerCaller, eventId, {
        guestId: g.guestId,
        count: 2,
        method: 'search',
        idempotencyKey: key(),
      });
      await transitionEvent(ctx, owner.userId, eventId, 'complete');
      const fix = { guestId: g.guestId, delta: -1, reason: 'غادر مبكراً', idempotencyKey: key() };
      expect((await correctAttendance(ctx, ownerCaller, eventId, fix)).guest.checkedIn).toBe(1);
      ctx.clock.now = new Date(ctx.clock.now.getTime() + 49 * 60 * 60_000);
      await expect(
        correctAttendance(ctx, ownerCaller, eventId, { ...fix, idempotencyKey: key() }),
      ).rejects.toEqual(code('checkin_not_open'));
      ctx.clock.now = new Date(ctx.clock.now.getTime() - 49 * 60 * 60_000);
    });

    it('registers a walk-in party in one step, apart from the invited forecast', async () => {
      const { eventId, guest, staff, owner } = await setup();
      await guest(1); // expected 2 people
      const plain = await staff();
      const sup = await staff(true);
      const input = { fullName: 'زائر بدون دعوة', partySize: 3, idempotencyKey: key() };
      await expect(registerWalkIn(ctx, plain.caller, eventId, input)).rejects.toEqual(
        code('forbidden'),
      );
      const r = await registerWalkIn(ctx, sup.caller, eventId, input);
      expect(r).toMatchObject({
        status: 'admitted',
        replayed: false,
        guest: { walkIn: true, expected: 3, checkedIn: 3, rsvpStatus: 'confirmed' },
      });
      // A retry doesn't create a second guest.
      const again = await registerWalkIn(ctx, sup.caller, eventId, input);
      expect(again).toMatchObject({ status: 'admitted', replayed: true });
      const walkIns = await ctx.db
        .select()
        .from(guests)
        .where(sql`${guests.eventId} = ${eventId} AND ${guests.source} = 'walk_in'`);
      expect(walkIns).toHaveLength(1);

      const live = await getLiveAttendance(ctx, owner.userId, eventId);
      expect(live.totals).toMatchObject({
        expectedPeople: 2,
        checkedInPeople: 3,
        walkInPeople: 3,
        walkInParties: 1,
        notArrived: 1,
      });
    });

    it('warns about a walk-in whose phone is already on the list', async () => {
      const { eventId, guest, ownerCaller } = await setup();
      await guest(0, { phone: '0559876543' });
      const r = await registerWalkIn(ctx, ownerCaller, eventId, {
        fullName: 'ضيف',
        phone: '0559876543',
        partySize: 1,
        idempotencyKey: key(),
      });
      expect(r.status).toBe('duplicate');
      if (r.status === 'duplicate') expect(r.duplicates[0]?.maskedPhone).toBe('•••• 6543');
      expect(JSON.stringify(r)).not.toContain('559876543');
    });

    it('lets a supervisor confirm an unanswered guest at the door', async () => {
      const { eventId, guest, staff } = await setup();
      const g = await guest(null);
      const plain = await staff();
      const sup = await staff(true);
      await expect(confirmAtDoor(ctx, plain.caller, eventId, g.guestId, 1)).rejects.toEqual(
        code('forbidden'),
      );
      const r = await confirmAtDoor(ctx, sup.caller, eventId, g.guestId, 1);
      expect(r.guest).toMatchObject({ rsvpStatus: 'confirmed', expected: 2, blocker: null });
      // Confirming again (or the guest confirming at the same time) changes nothing.
      const again = await confirmAtDoor(ctx, sup.caller, eventId, g.guestId, 3);
      expect(again).toMatchObject({ replayed: true, guest: { expected: 2 } });
      const passes = await ctx.db
        .select()
        .from(guestPasses)
        .where(eq(guestPasses.guestId, g.guestId));
      expect(passes).toHaveLength(1);
    });
  });

  describe('rules once people are inside', () => {
    it('locks the guest answer, and blocks shrinking the party or cancelling', async () => {
      const { eventId, guest, ownerCaller, owner } = await setup();
      const g = await guest(2);
      await checkIn(ctx, ownerCaller, eventId, {
        guestId: g.guestId,
        count: 2,
        method: 'search',
        idempotencyKey: key(),
      });
      await expect(
        respondToInvitation(ctx, g.link, { status: 'confirmed', companions: 0 }),
      ).rejects.toEqual(code('rsvp_locked_checked_in'));
      await expect(
        setGuestRsvp(ctx, owner.userId, eventId, g.guestId, { status: 'declined' }),
      ).rejects.toEqual(code('party_below_checked_in'));
      await expect(
        setGuestRsvp(ctx, owner.userId, eventId, g.guestId, { status: 'confirmed', companions: 0 }),
      ).rejects.toEqual(code('party_below_checked_in'));
      // The owner may still grow the party or keep it.
      await setGuestRsvp(ctx, owner.userId, eventId, g.guestId, {
        status: 'confirmed',
        companions: 3,
      });
      await expect(cancelGuest(ctx, owner.userId, eventId, g.guestId)).rejects.toEqual(
        code('guest_checked_in'),
      );
      const other = await guest(0);
      const bulk = await bulkCancel(ctx, owner.userId, eventId, [g.guestId, other.guestId]);
      expect(bulk).toMatchObject({ selected: 2, changed: 1 });
      await expect(
        transitionEvent(ctx, owner.userId, eventId, 'cancel', { reason: 'ظرف طارئ' }),
      ).rejects.toEqual(code('event_has_arrivals'));
    });

    it('keeps the ledger append-only and attendance written only by the ledger', async () => {
      const { eventId, guest, ownerCaller } = await setup();
      const g = await guest(0);
      await checkIn(ctx, ownerCaller, eventId, {
        guestId: g.guestId,
        count: 1,
        method: 'search',
        idempotencyKey: key(),
      });
      await expect(
        ctx.db.update(checkInLogs).set({ countDelta: 5 }).where(eq(checkInLogs.guestId, g.guestId)),
      ).rejects.toThrow();
      await expect(
        ctx.db.delete(checkInLogs).where(eq(checkInLogs.guestId, g.guestId)),
      ).rejects.toThrow();
      await expect(
        ctx.db
          .update(attendance)
          .set({ checkedInCount: 0 })
          .where(eq(attendance.guestId, g.guestId)),
      ).rejects.toThrow();
    });

    it('refuses ledger rows that pass the party size or skip the running count', async () => {
      const { eventId, guest, owner } = await setup();
      const g = await guest(1);
      const [m] = await ctx.db
        .execute<{ id: string }>(
          sql`SELECT id FROM event_memberships WHERE event_id = ${eventId} AND role = 'owner'`,
        )
        .then((r) => r.rows);
      const row = (delta: number, resulting: number) => ({
        eventId,
        guestId: g.guestId,
        action: 'check_in' as const,
        method: 'search' as const,
        countDelta: delta,
        resultingCount: resulting,
        actorMembershipId: m!.id,
        idempotencyKey: key(),
        createdAt: new Date(),
      });
      await expect(ctx.db.insert(checkInLogs).values(row(3, 3))).rejects.toThrow();
      await expect(ctx.db.insert(checkInLogs).values(row(1, 2))).rejects.toThrow();
      await ctx.db.insert(checkInLogs).values(row(1, 1));
      const [r] = await ctx.db.select().from(rsvps).where(eq(rsvps.guestId, g.guestId));
      expect(r?.status).toBe('confirmed');
      expect(owner.userId).toBeTruthy();
    });
  });
  describe('supervisor team view', () => {
    it('lists the team without phones, and only for supervisors', async () => {
      const { eventId, staff } = await setup();
      const plain = await staff();
      const sup = await staff(true);
      await expect(listDoorTeam(ctx, plain.caller, eventId)).rejects.toEqual(code('forbidden'));
      const team = await listDoorTeam(ctx, sup.caller, eventId);
      expect(team.map((m) => [m.displayName, m.devices, m.linkPending, m.self])).toEqual([
        ['خالد', 1, false, false],
        ['فهد', 1, false, true],
      ]);
      expect(JSON.stringify(team)).not.toContain('+966');
      await revokeStaffAccess(ctx, sup.caller, eventId, plain.membershipId);
      expect((await listDoorTeam(ctx, sup.caller, eventId))[0]?.devices).toBe(0);
    });
  });

  describe('guest list', () => {
    it('filters by arrival and shows walk-ins as their own source', async () => {
      const { eventId, guest, owner, ownerCaller } = await setup();
      const none = await guest(1);
      const part = await guest(2);
      const full = await guest(0);
      await guest(null);
      await checkIn(ctx, ownerCaller, eventId, {
        guestId: part.guestId,
        count: 1,
        method: 'search',
        idempotencyKey: key(),
      });
      await checkIn(ctx, ownerCaller, eventId, {
        guestId: full.guestId,
        count: 1,
        method: 'search',
        idempotencyKey: key(),
      });
      await registerWalkIn(ctx, ownerCaller, eventId, {
        fullName: 'زائر',
        partySize: 2,
        idempotencyKey: key(),
      });
      const ids = async (q: Record<string, string>) =>
        (await listGuests(ctx, owner.userId, eventId, q)).rows.map((r) => r.id).sort();
      expect(await ids({ attendance: 'not_arrived' })).toEqual([none.guestId]);
      expect(await ids({ attendance: 'partial' })).toEqual([part.guestId]);
      const complete = await listGuests(ctx, owner.userId, eventId, { attendance: 'complete' });
      expect(complete.total).toBe(2);
      expect(complete.rows.find((r) => r.id === full.guestId)?.checkedIn).toBe(1);
      const walkIns = await listGuests(ctx, owner.userId, eventId, { source: 'walk_in' });
      expect(walkIns.rows.map((r) => [r.fullName, r.checkedIn])).toEqual([['زائر', 2]]);
      expect(await attendanceSummary(ctx, owner.userId, eventId)).toMatchObject({
        checkedInPeople: 4,
        invitedCheckedIn: 2,
        walkInPeople: 2,
        expectedPeople: 6,
        complete: 1,
        partial: 1,
        notArrived: 1,
        pendingGuests: 1,
      });
    });
  });
});
