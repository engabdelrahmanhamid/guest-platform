import { randomUUID } from 'node:crypto';
import { guestPasses, guests, invitations, rsvps, staffSessions } from '@gp/db/schema';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { getLiveAttendance, getDoorOverview } from '../checkin/attendance';
import {
  checkIn,
  correctAttendance,
  lookupQr,
  registerWalkIn,
  searchDoor,
} from '../checkin/checkin';
import type { DoorCaller } from '../checkin/door';
import { redeemStaffLink, revokeStaffAccess, sendStaffAccess } from '../checkin/staff-access';
import { createEvent, transitionEvent } from '../events/events';
import { commitImport, createImportBatch, setImportDecisions } from '../guests/import';
import { invitationToken } from '../lifecycle/invitations';
import { passToken } from '../lifecycle/passes';
import { respondToInvitation } from '../lifecycle/rsvp';
import { addStaff } from '../memberships/memberships';
import { createOwner, createTestContext, databaseUrl, eventInput } from '../testing/harness';
import { excelLikeXlsx, TEMPLATE_ROW } from '../testing/xlsx';

/**
 * Event-day rehearsal with a realistic, messy guest list. It is opt-in (`REHEARSAL=1 pnpm test
 * rehearsal`) because it is slow and prints a report; CI skips it. It walks the whole pilot path
 * through the real domain functions: import a spreadsheet, invite, answer, open the door, admit
 * with four scanners at once (partial parties, double scans, searches, walk-ins, corrections,
 * a revoked device, retries), close and reopen, then reconcile people, parties and ledger rows.
 * All names and numbers are invented.
 */
const on = process.env.REHEARSAL === '1';

// A small deterministic random source, so a failing run can be repeated.
let seed = 20261001;
const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]!;

const FIRST = [
  'محمد',
  'عبدالله',
  'فهد',
  'سلطان',
  'نورة',
  'سارة',
  'ريم',
  'لطيفة',
  'تركي',
  'ماجد',
  'هيا',
  'منال',
  'بدر',
  'خالد',
  'أمل',
  'جود',
];
const FAMILY = [
  'العتيبي',
  'القحطاني',
  'الدوسري',
  'الشهري',
  'الحربي',
  'المطيري',
  'الغامدي',
  'الزهراني',
  'السبيعي',
  'العنزي',
];
const GROUPS = ['أقارب العريس', 'عائلة العروس', 'زملاء العمل', 'الأصدقاء', null, null];

function spreadsheet(valid: number) {
  const rows: (string | number | null)[][] = [TEMPLATE_ROW];
  for (let i = 0; i < valid; i++) {
    const n = 500000000 + i * 7919;
    // Phones as people really type them: national with 0, without 0, +966, Arabic digits, numbers.
    const phone =
      i % 5 === 0
        ? `0${n}`
        : i % 5 === 1
          ? String(n)
          : i % 5 === 2
            ? `+966${n}`
            : i % 5 === 3
              ? `00966${n}`
              : n;
    rows.push([
      `${pick(FIRST)} ${pick(FAMILY)} ${i}`,
      phone,
      i % 9 === 0 ? `guest${i}@example.sa` : null,
      pick(GROUPS),
      i % 4 === 0 ? null : Math.floor(rnd() * 4),
      null,
    ]);
  }
  rows.push(['', '0551239999']); // missing name
  rows.push(['رقم ناقص', '05512']); // invalid phone
  rows.push(['رقمان', '0551231111 / 0551232222']); // two numbers in one cell
  rows.push(['بريد خاطئ', '0551233333', 'not-mail']);
  rows.push(['مرافقون كثير', '0551234444', null, null, 30]);
  rows.push(['=HYPERLINK("http://x")', '0551235555']); // formula-looking name
  rows.push(['مكرر داخل الملف', String(500000000)]); // same phone as the first data row
  return excelLikeXlsx(rows);
}

describe.skipIf(!databaseUrl || !on)('event-day rehearsal', () => {
  const ctx = createTestContext(new Date('2036-05-01T09:00:00Z'));

  it(
    'runs a realistic event from spreadsheet to reconciliation',
    { timeout: 300_000 },
    async () => {
      const t0 = Date.now();
      const report: Record<string, unknown> = {};

      // 1. Owner, event, import.
      const owner = await createOwner(ctx);
      const { eventId } = await createEvent(
        ctx,
        owner.userId,
        eventInput(ctx, { name: 'حفل زفاف (بروفة)', defaultAllowedCompanions: '3' }),
      );
      await transitionEvent(ctx, owner.userId, eventId, 'activate');
      const batch = await createImportBatch(ctx, owner.userId, eventId, {
        name: 'guests.xlsx',
        bytes: spreadsheet(400),
      });
      // The owner reviews: good rows import, invalid rows and suspected repeats are skipped.
      await setImportDecisions(
        ctx,
        owner.userId,
        eventId,
        batch.batchId,
        { filter: 'ready' },
        'import',
      );
      await setImportDecisions(
        ctx,
        owner.userId,
        eventId,
        batch.batchId,
        { filter: 'needs_review' },
        'skip',
      );
      await setImportDecisions(
        ctx,
        owner.userId,
        eventId,
        batch.batchId,
        { filter: 'invalid' },
        'skip',
      );
      const committed = await commitImport(ctx, owner.userId, eventId, batch.batchId);
      if (committed.status !== 'committed') throw new Error('import needs review');
      report.import = { imported: committed.imported, skipped: committed.skipped };
      // 400 good rows plus the formula-looking name (kept as text; exports escape it). Skipped: five
      // invalid rows and the phone repeated inside the file.
      expect(committed.imported).toBe(401);
      expect(committed.skipped).toBe(6);

      // 2. Invitations opened and answered on the guests' own links.
      const inv = await ctx.db.select().from(invitations).where(eq(invitations.eventId, eventId));
      const allowed = new Map(
        (await ctx.db.select().from(guests).where(eq(guests.eventId, eventId))).map((g) => [
          g.id,
          g.allowedCompanions,
        ]),
      );
      const answers = { confirmed: 0, declined: 0, pending: 0 };
      await Promise.all(
        inv.map(async (i) => {
          const r = rnd();
          const link = invitationToken(i, ctx.encryptionKey);
          if (r < 0.62) {
            await respondToInvitation(ctx, link, {
              status: 'confirmed',
              companions: Math.floor(rnd() * (allowed.get(i.guestId)! + 1)),
            });
            answers.confirmed++;
          } else if (r < 0.74) {
            await respondToInvitation(ctx, link, { status: 'declined' });
            answers.declined++;
          } else answers.pending++;
        }),
      );
      report.answers = answers;

      // 3. Door opens; four devices sign in from their links (one supervisor).
      ctx.clock.now = new Date(ctx.clock.now.getTime() + 7 * 86_400_000 + 11 * 3_600_000);
      await transitionEvent(ctx, owner.userId, eventId, 'start');
      const ownerCaller: DoorCaller = { kind: 'owner', userId: owner.userId };
      const devices = [] as { membershipId: string; caller: DoorCaller }[];
      for (const [i, name] of ['خالد', 'فهد', 'منى', 'ياسر (مشرف)'].entries()) {
        const { membershipId } = await addStaff(ctx, owner.userId, eventId, {
          displayName: name,
          isSupervisor: i === 3 ? 'on' : undefined,
        });
        const { url } = await sendStaffAccess(ctx, ownerCaller, eventId, membershipId);
        const { sessionToken } = await redeemStaffLink(
          ctx,
          url.split('/s/')[1]!,
          `Device ${i + 1}`,
        );
        devices.push({ membershipId, caller: { kind: 'staff', sessionToken } });
      }
      const supervisor = devices[3]!;

      // 4. Arrivals. Every confirmed guest arrives at one of the scanners with their QR.
      const parties = await ctx.db
        .select({
          guestId: guests.id,
          name: guests.fullName,
          phone: guests.phoneE164,
          companions: rsvps.companionCount,
          passId: guestPasses.id,
        })
        .from(guests)
        .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
        .innerJoin(
          guestPasses,
          sql`${guestPasses.guestId} = ${guests.id} AND ${guestPasses.status} = 'active'`,
        )
        .where(sql`${guests.eventId} = ${eventId} AND ${rsvps.status} = 'confirmed'`);
      const passRows = await ctx.db
        .select()
        .from(guestPasses)
        .where(eq(guestPasses.eventId, eventId));
      const qrOf = new Map(passRows.map((p) => [p.id, `GP1.${passToken(p, ctx.encryptionKey)}`]));

      const tally = {
        fullAtOnce: 0,
        inParts: 0,
        doubleScanRefused: 0,
        viaSearch: 0,
        blocked: 0,
        retriesReplayed: 0,
        revokedDeviceRerouted: 0,
      };
      const errors = new Map<string, number>();
      const fail = (e: unknown) => {
        const c = (e as { code?: string }).code ?? 'unknown';
        errors.set(c, (errors.get(c) ?? 0) + 1);
        return c;
      };

      async function admit(
        dev: DoorCaller,
        p: (typeof parties)[number],
        count: number,
        method: 'qr' | 'search',
      ) {
        const key = randomUUID();
        const input = {
          guestId: p.guestId,
          count,
          method,
          passId: method === 'qr' ? p.passId : undefined,
          idempotencyKey: key,
        };
        const r = await checkIn(ctx, dev, eventId, input);
        // A flaky network: some taps are sent again with the same key and must change nothing.
        if (rnd() < 0.04) {
          const again = await checkIn(ctx, dev, eventId, input);
          if (again.replayed) tally.retriesReplayed++;
          expect(again.guest.checkedIn).toBe(r.guest.checkedIn);
        }
        return r;
      }

      const queues = devices.map(() => [] as typeof parties);
      parties.forEach((p, i) => queues[i % devices.length]!.push(p));
      const revokedAfter = Math.floor(queues[2]!.length / 2);
      const laterParts: typeof parties = [];

      await Promise.all(
        devices.map(async (dev, d) => {
          for (const [n, p] of queues[d]!.entries()) {
            // A device shut out mid-event: its remaining guests walk to another scanner.
            if (d === 2 && n === revokedAfter) {
              await revokeStaffAccess(ctx, ownerCaller, eventId, dev.membershipId);
            }
            let caller = dev.caller;
            if (d === 2 && n >= revokedAfter) {
              await expect(
                lookupQr(ctx, dev.caller, eventId, qrOf.get(p.passId)!),
              ).rejects.toMatchObject({ code: 'staff_session_invalid' });
              tally.revokedDeviceRerouted++;
              caller = devices[0]!.caller;
            }
            const size = 1 + p.companions;
            const r = rnd();
            try {
              const found = await lookupQr(ctx, caller, eventId, qrOf.get(p.passId)!);
              expect(found.found).toBe(true);
              if (r < 0.7) {
                await admit(caller, p, size, 'qr');
                tally.fullAtOnce++;
              } else if (r < 0.85 && size > 1) {
                const first = 1 + Math.floor(rnd() * (size - 1));
                await admit(caller, p, first, 'qr');
                laterParts.push(p); // the rest of the party arrives later, at another scanner
                tally.inParts++;
              } else if (r < 0.93) {
                // The QR won't scan: the guest is found by name.
                const hits = await searchDoor(ctx, caller, eventId, p.name);
                expect(hits.some((h) => h.guestId === p.guestId)).toBe(true);
                await admit(caller, p, size, 'search');
                tally.viaSearch++;
              } else {
                // Two people show the same QR at two scanners at the same moment.
                const other = devices[(d + 1) % devices.length]!.caller;
                const results = await Promise.allSettled([
                  admit(caller, p, size, 'qr'),
                  admit(other, p, size, 'qr'),
                ]);
                const ok = results.filter((x) => x.status === 'fulfilled').length;
                if (ok === 1) tally.doubleScanRefused++;
                expect(ok).toBeGreaterThanOrEqual(1);
                tally.fullAtOnce++;
              }
            } catch (e) {
              fail(e);
            }
          }
        }),
      );

      // The rest of each split party, then a guest who never answered, and one who declined.
      for (const [i, p] of laterParts.entries()) {
        const now = await lookupQr(ctx, devices[i % 2]!.caller, eventId, qrOf.get(p.passId)!);
        if (now.found && now.guest.remaining > 0)
          await admit(devices[i % 2]!.caller, p, now.guest.remaining, 'qr');
      }
      const [pendingGuest] = await ctx.db
        .select({ id: guests.id, name: guests.fullName })
        .from(guests)
        .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
        .where(sql`${guests.eventId} = ${eventId} AND ${rsvps.status} = 'pending'`)
        .limit(1);
      await expect(
        checkIn(ctx, devices[0]!.caller, eventId, {
          guestId: pendingGuest!.id,
          count: 1,
          method: 'search',
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'not_confirmed' });
      tally.blocked++;

      // 5. Walk-ins (supervisor only), one with a phone already on the list.
      const walkIns = [1, 2, 4, 1, 3, 2, 1, 5, 2, 1, 1, 3];
      for (const [i, size] of walkIns.entries()) {
        await registerWalkIn(ctx, supervisor.caller, eventId, {
          fullName: `زائر بدون دعوة ${i + 1}`,
          partySize: size,
          idempotencyKey: randomUUID(),
        });
      }
      const dup = await registerWalkIn(ctx, supervisor.caller, eventId, {
        fullName: 'ضيف بجوال موجود',
        phone: `0${500000000 + 7919 * 3}`,
        partySize: 1,
        idempotencyKey: randomUUID(),
      });
      expect(dup.status).toBe('duplicate');
      await expect(
        registerWalkIn(ctx, devices[0]!.caller, eventId, {
          fullName: 'زائر',
          partySize: 1,
          idempotencyKey: randomUUID(),
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });

      // 6. Owner corrects five parties (someone left, a count was wrong); each is its own ledger row.
      const someInside = await ctx.db.execute<{ guest_id: string }>(
        sql`select guest_id from attendance where event_id = ${eventId} and checked_in_count >= 2 limit 5`,
      );
      for (const row of someInside.rows) {
        await correctAttendance(ctx, ownerCaller, eventId, {
          guestId: row.guest_id,
          delta: -1,
          reason: 'غادر أحد أفراد المجموعة',
          idempotencyKey: randomUUID(),
        });
      }

      // 7. Reconcile: people, parties and ledger rows must never be confused.
      const live = await getLiveAttendance(ctx, owner.userId, eventId);
      const q = async <T extends Record<string, unknown>>(s: ReturnType<typeof sql>) =>
        (await ctx.db.execute<T>(s)).rows[0]!;
      const sums = await q<{ projection: string; ledger: string; rows: string; over: string }>(sql`
      select (select coalesce(sum(checked_in_count),0) from attendance where event_id = ${eventId}) as projection,
             (select coalesce(sum(count_delta),0) from check_in_logs where event_id = ${eventId}) as ledger,
             (select count(*) from check_in_logs where event_id = ${eventId}) as rows,
             (select count(*) from attendance a join guests g on g.id = a.guest_id join rsvps r on r.guest_id = g.id
               where a.event_id = ${eventId} and g.source <> 'walk_in' and a.checked_in_count > 1 + r.companion_count) as over`);
      const inside = Number(sums.projection);
      expect(inside).toBe(Number(sums.ledger));
      expect(inside).toBe(live.totals.checkedInPeople);
      expect(Number(sums.over)).toBe(0);
      expect(Number(sums.rows)).toBeLessThan(inside); // ledger operations are not people
      expect(live.totals.complete + live.totals.partial + live.totals.notArrived).toBe(
        parties.length,
      );
      expect(live.totals.walkInPeople).toBe(walkIns.reduce((a, b) => a + b, 0));
      report.door = { ...tally, unexpectedRefusals: Object.fromEntries(errors) };
      report.reconciliation = {
        peopleInside: inside,
        ledgerRows: Number(sums.rows),
        invitedParties: parties.length,
        complete: live.totals.complete,
        partial: live.totals.partial,
        notArrived: live.totals.notArrived,
        walkInPeople: live.totals.walkInPeople,
      };

      // 8. Close the event: devices stop; only the owner corrects, then reopen brings back the paused.
      await transitionEvent(ctx, owner.userId, eventId, 'complete');
      await expect(getDoorOverview(ctx, devices[0]!.caller, eventId)).rejects.toMatchObject({
        code: 'staff_session_invalid',
      });
      await transitionEvent(ctx, owner.userId, eventId, 'reopen');
      expect((await getDoorOverview(ctx, devices[0]!.caller, eventId)).event.status).toBe('live');
      await expect(getDoorOverview(ctx, devices[2]!.caller, eventId)).rejects.toMatchObject({
        code: 'staff_session_invalid',
      });
      const ended = await ctx.db
        .select({ reason: staffSessions.endReason })
        .from(staffSessions)
        .where(eq(staffSessions.eventId, eventId));
      report.sessionsEndedBy = ended.filter((s) => s.reason).map((s) => s.reason);

      const [{ n }] = (
        await ctx.db.execute<{ n: string }>(
          sql`select count(*) n from check_in_logs where event_id = ${eventId}`,
        )
      ).rows as [{ n: string }];
      expect(Number(n)).toBe(Number(sums.rows));
      report.seconds = Math.round((Date.now() - t0) / 1000);
      process.stdout.write(`REHEARSAL REPORT\n${JSON.stringify(report, null, 2)}\n`);
    },
  );
});
