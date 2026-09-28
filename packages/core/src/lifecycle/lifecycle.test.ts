import { activity, guestPasses, invitations, rsvps } from '@gp/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEvent, transitionEvent } from '../events/events';
import { createGroup } from '../guests/groups';
import {
  addGuest,
  bulkCancel,
  bulkSetCompanions,
  cancelGuest,
  deleteGuest,
  listGuests,
  restoreGuest,
  updateGuest,
} from '../guests/guests';
import { readSpreadsheet } from '../guests/spreadsheet';
import { newId } from '../shared/ids';
import { isPublicToken, publicToken } from '../shared/tokens';
import { createOwner, createTestContext, databaseUrl, eventInput } from '../testing/harness';
import {
  exportInvitationLinks,
  getGuestPage,
  getInvitationPreview,
  getShareContent,
  getShareQueue,
  recordInvitationOpen,
  recordInvitationShare,
  rotateInvitationLink,
} from './invitations';
import { getGuestLifecycle, rsvpSummary } from './overview';
import { replaceGuestPass, respondToInvitation, setGuestRsvp } from './rsvp';
import { DEFAULT_SHARE_TEXT, getShareText, renderShareText, saveShareText } from './share-text';
import { expectedPartySize, passDisplay, qrPayload } from './state';

const code = (c: string) => expect.objectContaining({ code: c });

describe('public tokens', () => {
  it('are 22 base62 characters and do not repeat', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const t = publicToken();
      expect(isPublicToken(t)).toBe(true);
      seen.add(t);
    }
    expect(seen.size).toBe(5000);
    expect(isPublicToken('short')).toBe(false);
    expect(isPublicToken('../../etc/passwd/xxxxxxxx')).toBe(false);
  });

  it('puts only the opaque pass token in the QR', () => {
    const token = publicToken();
    expect(qrPayload(token)).toBe(`GP1.${token}`);
    expect(qrPayload(token)).not.toMatch(/https?:|\/|@|\+/);
  });
});

describe.skipIf(!databaseUrl)('invitations, RSVP and passes', () => {
  const ctx = createTestContext(new Date('2034-01-01T09:00:00Z'));

  async function setup(opts: { activate?: boolean; companions?: string } = {}) {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(
      ctx,
      owner.userId,
      eventInput(ctx, { defaultAllowedCompanions: opts.companions ?? '2' }),
    );
    if (opts.activate !== false) await transitionEvent(ctx, owner.userId, eventId, 'activate');
    const add = async (input: Record<string, unknown> = {}) => {
      const r = await addGuest(ctx, owner.userId, eventId, {
        fullName: 'محمد العتيبي',
        phone: `05${Math.floor(10_000_000 + Math.random() * 89_999_999)}`,
        ...input,
      });
      if (r.status !== 'saved') throw new Error('unexpected duplicate');
      const [inv] = await ctx.db
        .select()
        .from(invitations)
        .where(eq(invitations.guestId, r.guestId));
      return { guestId: r.guestId, token: inv!.token };
    };
    return { userId: owner.userId, eventId, add };
  }

  const passesOf = (guestId: string) =>
    ctx.db
      .select()
      .from(guestPasses)
      .where(eq(guestPasses.guestId, guestId))
      // The test clock is frozen, so passes can share an issue time: revoked ones sort first.
      .orderBy(guestPasses.issuedAt, sql`${guestPasses.revokedAt} ASC NULLS LAST`);
  const typesOf = async (guestId: string) =>
    (
      await ctx.db
        .select({ type: activity.type, actorType: activity.actorType })
        .from(activity)
        .where(eq(activity.guestId, guestId))
        .orderBy(activity.id)
    ).map((a) => `${a.type}:${a.actorType}`);

  describe('invitation link', () => {
    it('is created with every guest, with a pending answer, even if nothing is sent', async () => {
      const { eventId, add } = await setup();
      const { guestId, token } = await add();
      expect(isPublicToken(token)).toBe(true);
      const [answer] = await ctx.db.select().from(rsvps).where(eq(rsvps.guestId, guestId));
      expect(answer).toMatchObject({
        eventId,
        status: 'pending',
        companionCount: 0,
        respondedAt: null,
      });
      const [inv] = await ctx.db.select().from(invitations).where(eq(invitations.guestId, guestId));
      expect(inv).toMatchObject({ deliveryStatus: 'not_sent', shareCount: 0, openCount: 0 });
      expect(await typesOf(guestId)).toEqual(['guest.created:member', 'invitation.created:member']);
    });

    it('shows nothing for an unknown or malformed token', async () => {
      expect(await getGuestPage(ctx, publicToken())).toBeNull();
      expect(await getGuestPage(ctx, 'not-a-token')).toBeNull();
      await expect(respondToInvitation(ctx, publicToken(), { status: 'declined' })).rejects.toEqual(
        code('not_found'),
      );
      expect(await recordInvitationOpen(ctx, publicToken())).toBe(false);
    });

    it('follows the event state, and shows no personal data before publishing', async () => {
      const { userId, eventId, add } = await setup({ activate: false });
      const { token } = await add();
      const draft = await getGuestPage(ctx, token);
      expect(draft).toMatchObject({ state: 'unavailable', guest: null, rsvp: null, pass: null });
      expect(JSON.stringify(draft)).not.toContain('العتيبي');
      expect(await recordInvitationOpen(ctx, token)).toBe(false);
      await expect(respondToInvitation(ctx, token, { status: 'declined' })).rejects.toEqual(
        code('rsvp_closed'),
      );

      await transitionEvent(ctx, userId, eventId, 'activate');
      expect(await getGuestPage(ctx, token)).toMatchObject({
        state: 'open',
        guest: { fullName: 'محمد العتيبي', allowedCompanions: 2 },
        rsvp: { status: 'pending' },
      });
      await respondToInvitation(ctx, token, { status: 'confirmed', companions: '1' });

      await transitionEvent(ctx, userId, eventId, 'start');
      expect((await getGuestPage(ctx, token))?.state).toBe('open');
      await respondToInvitation(ctx, token, { status: 'confirmed', companions: '2' });

      await transitionEvent(ctx, userId, eventId, 'complete');
      const closed = await getGuestPage(ctx, token);
      expect(closed).toMatchObject({
        state: 'closed',
        rsvp: { status: 'confirmed', companionCount: 2 },
      });
      expect(closed?.pass?.display).toBe('ended');
      await expect(respondToInvitation(ctx, token, { status: 'declined' })).rejects.toEqual(
        code('rsvp_closed'),
      );
      await transitionEvent(ctx, userId, eventId, 'archive');
      expect((await getGuestPage(ctx, token))?.state).toBe('closed');
    });

    it('shows the cancellation, with no answer buttons and no QR, once the event is cancelled', async () => {
      const { userId, eventId, add } = await setup();
      const { token } = await add();
      await respondToInvitation(ctx, token, { status: 'confirmed', companions: 0 });
      await transitionEvent(ctx, userId, eventId, 'cancel', { reason: 'ظرف طارئ' });
      const page = await getGuestPage(ctx, token);
      expect(page).toMatchObject({ state: 'cancelled', rsvp: null, pass: null });
      await expect(
        respondToInvitation(ctx, token, { status: 'confirmed', companions: 1 }),
      ).rejects.toEqual(code('rsvp_closed'));
      // Passes are not rewritten; the event state makes them unusable.
      const [pass] = await ctx.db
        .select()
        .from(guestPasses)
        .where(eq(guestPasses.status, 'active'))
        .limit(1);
      expect(pass).toBeTruthy();
      await transitionEvent(ctx, userId, eventId, 'archive');
      expect((await getGuestPage(ctx, token))?.state).toBe('cancelled');
    });

    it('rotates: the old link stops working at once, the answer and pass stay', async () => {
      const { userId, eventId, add } = await setup();
      const { guestId, token } = await add();
      await respondToInvitation(ctx, token, { status: 'confirmed', companions: 1 });
      const [before] = await passesOf(guestId);
      const { token: fresh } = await rotateInvitationLink(ctx, userId, eventId, guestId);
      expect(fresh).not.toBe(token);
      expect(await getGuestPage(ctx, token)).toBeNull();
      await expect(respondToInvitation(ctx, token, { status: 'declined' })).rejects.toEqual(
        code('not_found'),
      );
      const page = await getGuestPage(ctx, fresh);
      expect(page?.rsvp).toEqual({ status: 'confirmed', companionCount: 1 });
      expect(page?.pass?.token).toBe(before!.token);
      expect(await typesOf(guestId)).toContain('invitation.token_rotated:member');
    });

    it('counts opens from the page beacon, one per visit, and records the first open once', async () => {
      const { userId, eventId, add } = await setup();
      const { guestId, token } = await add();
      expect(await recordInvitationOpen(ctx, token)).toBe(true);
      expect(await recordInvitationOpen(ctx, token)).toBe(true); // same visit
      let [inv] = await ctx.db.select().from(invitations).where(eq(invitations.guestId, guestId));
      expect(inv).toMatchObject({ openCount: 1 });
      ctx.clock.now = new Date(ctx.clock.now.getTime() + 31 * 60_000);
      await recordInvitationOpen(ctx, token);
      [inv] = await ctx.db.select().from(invitations).where(eq(invitations.guestId, guestId));
      expect(inv?.openCount).toBe(2);
      expect(inv?.lastOpenedAt?.getTime()).toBeGreaterThan(inv!.openedAt!.getTime());
      expect((await typesOf(guestId)).filter((t) => t.startsWith('invitation.opened'))).toEqual([
        'invitation.opened:guest',
      ]);
      const view = await getGuestLifecycle(ctx, userId, eventId, guestId);
      expect(view.invitation).toMatchObject({ openCount: 2, shareCount: 0 });
      // Opening is not sharing: nothing claims the owner sent it.
      expect(view.invitation.deliveryStatus).toBe('not_sent');
    });

    it('counts an answer as an open when the beacon never ran', async () => {
      const { add } = await setup();
      const { guestId, token } = await add();
      await respondToInvitation(ctx, token, { status: 'declined' });
      const [inv] = await ctx.db.select().from(invitations).where(eq(invitations.guestId, guestId));
      expect(inv?.openCount).toBe(1);
    });
  });

  describe('RSVP and passes', () => {
    it('confirm issues a pass; decline revokes it; confirming again issues a new token', async () => {
      const { add } = await setup();
      const { guestId, token } = await add();

      const confirmed = await respondToInvitation(ctx, token, {
        status: 'confirmed',
        companions: 2,
      });
      expect(confirmed).toMatchObject({
        changed: true,
        rsvp: { status: 'confirmed', companionCount: 2 },
      });
      const passA = confirmed.pass!;
      expect(passA.status).toBe('active');

      const declined = await respondToInvitation(ctx, token, { status: 'declined' });
      expect(declined).toMatchObject({
        rsvp: { status: 'declined', companionCount: 0 },
        pass: null,
      });

      const again = await respondToInvitation(ctx, token, { status: 'confirmed', companions: 1 });
      const passB = again.pass!;
      expect(passB.token).not.toBe(passA.token);

      const all = await passesOf(guestId);
      expect(all.map((p) => [p.token, p.status, p.revokeReason])).toEqual([
        [passA.token, 'revoked', 'declined'],
        [passB.token, 'active', null],
      ]);
      expect(await typesOf(guestId)).toEqual([
        'guest.created:member',
        'invitation.created:member',
        'rsvp.confirmed:guest',
        'pass.issued:guest',
        'invitation.opened:guest',
        'rsvp.declined:guest',
        'pass.revoked:guest',
        'rsvp.confirmed:guest',
        'pass.issued:guest',
      ]);
    });

    it('declines straight from pending, and changes companions without a new pass', async () => {
      const { add } = await setup();
      const a = await add();
      expect((await respondToInvitation(ctx, a.token, { status: 'declined' })).rsvp.status).toBe(
        'declined',
      );
      expect(await passesOf(a.guestId)).toEqual([]);

      const b = await add();
      const first = await respondToInvitation(ctx, b.token, { status: 'confirmed', companions: 0 });
      const changed = await respondToInvitation(ctx, b.token, {
        status: 'confirmed',
        companions: 2,
      });
      expect(changed.pass?.id).toBe(first.pass?.id);
      expect(await typesOf(b.guestId)).toContain('rsvp.changed:guest');
    });

    it('keeps companions within the allowance, and never goes back to pending', async () => {
      const { add } = await setup({ companions: '1' });
      const { token } = await add();
      await expect(
        respondToInvitation(ctx, token, { status: 'confirmed', companions: 2 }),
      ).rejects.toEqual(code('companions_over_allowance'));
      await expect(
        respondToInvitation(ctx, token, { status: 'confirmed', companions: -1 }),
      ).rejects.toEqual(code('validation_failed'));
      await expect(respondToInvitation(ctx, token, { status: 'pending' })).rejects.toEqual(
        code('validation_failed'),
      );
      await expect(
        respondToInvitation(ctx, token, { status: 'confirmed', companions: 'two' }),
      ).rejects.toEqual(code('validation_failed'));
    });

    it('repeating the same answer writes nothing', async () => {
      const { add } = await setup();
      const { guestId, token } = await add();
      await respondToInvitation(ctx, token, { status: 'confirmed', companions: 1 });
      const before = await typesOf(guestId);
      const repeat = await respondToInvitation(ctx, token, { status: 'confirmed', companions: 1 });
      expect(repeat.changed).toBe(false);
      expect(await typesOf(guestId)).toEqual(before);
      expect(await passesOf(guestId)).toHaveLength(1);
    });

    it('lets the owner record an answer, with the owner named as the actor', async () => {
      const { userId, eventId, add } = await setup();
      const { guestId } = await add();
      await setGuestRsvp(ctx, userId, eventId, guestId, { status: 'confirmed', companions: '2' });
      const view = await getGuestLifecycle(ctx, userId, eventId, guestId);
      expect(view.rsvp).toMatchObject({
        status: 'confirmed',
        companionCount: 2,
        partySize: 3,
        by: 'member',
      });
      expect(view.rsvp.byName).toBeTruthy();
      expect(view.pass.current?.display).toBe('valid');
      expect(await typesOf(guestId)).toContain('rsvp.confirmed:member');
      expect(await typesOf(guestId)).not.toContain('rsvp.confirmed:guest');

      const replaced = await replaceGuestPass(ctx, userId, eventId, guestId);
      const all = await passesOf(guestId);
      expect(all).toHaveLength(2);
      expect(all[0]).toMatchObject({
        status: 'revoked',
        revokeReason: 'replaced',
        replacedByPassId: replaced.id,
      });
      expect(await typesOf(guestId)).toContain('pass.replaced:member');
    });

    it('revokes the pass when the guest is cancelled and issues a new one on restore', async () => {
      const { userId, eventId, add } = await setup();
      const { guestId, token } = await add();
      const { pass } = await respondToInvitation(ctx, token, {
        status: 'confirmed',
        companions: 1,
      });
      await cancelGuest(ctx, userId, eventId, guestId);
      expect(await getGuestPage(ctx, token)).toMatchObject({
        state: 'unavailable',
        guest: null,
        pass: null,
      });
      await expect(respondToInvitation(ctx, token, { status: 'declined' })).rejects.toEqual(
        code('guest_not_active'),
      );
      await expect(
        setGuestRsvp(ctx, userId, eventId, guestId, { status: 'declined' }),
      ).rejects.toEqual(code('guest_not_active'));
      expect((await rsvpSummary(ctx, userId, eventId)).expectedAttendance).toBe(0);

      await restoreGuest(ctx, userId, eventId, guestId);
      const all = await passesOf(guestId);
      expect(all.map((p) => [p.status, p.revokeReason])).toEqual([
        ['revoked', 'guest_cancelled'],
        ['active', null],
      ]);
      expect(all[1]!.token).not.toBe(pass!.token);
      // The answer survived the cancellation.
      expect((await getGuestPage(ctx, token))?.rsvp).toEqual({
        status: 'confirmed',
        companionCount: 1,
      });
    });

    it('revokes passes in a bulk cancellation', async () => {
      const { userId, eventId, add } = await setup();
      const a = await add();
      const b = await add();
      await respondToInvitation(ctx, a.token, { status: 'confirmed', companions: 0 });
      const result = await bulkCancel(ctx, userId, eventId, [a.guestId, b.guestId]);
      expect(result).toMatchObject({ selected: 2, changed: 2 });
      expect((await passesOf(a.guestId))[0]).toMatchObject({
        status: 'revoked',
        revokeReason: 'guest_cancelled',
      });
    });

    it('refuses to lower an allowance below what a guest confirmed', async () => {
      const { userId, eventId, add } = await setup();
      const { guestId, token } = await add({ phone: '0551112233' });
      await respondToInvitation(ctx, token, { status: 'confirmed', companions: 2 });
      await expect(
        updateGuest(ctx, userId, eventId, guestId, {
          fullName: 'محمد العتيبي',
          phone: '0551112233',
          allowedCompanions: '1',
        }),
      ).rejects.toEqual(code('allowance_below_response'));
      await expect(bulkSetCompanions(ctx, userId, eventId, [guestId], '0')).rejects.toEqual(
        code('allowance_below_response'),
      );
      await bulkSetCompanions(ctx, userId, eventId, [guestId], '3');
    });

    it('blocks the owner outside active and live events', async () => {
      const { userId, eventId, add } = await setup({ activate: false });
      const { guestId } = await add();
      await expect(
        setGuestRsvp(ctx, userId, eventId, guestId, { status: 'confirmed', companions: 0 }),
      ).rejects.toEqual(code('rsvp_closed'));
    });

    it('derives pass usability from the event, never from stored expiry', () => {
      const active = { status: 'active' as const };
      const guest = { status: 'active' as const };
      const yes = { status: 'confirmed' as const };
      const ev = (
        status: 'active' | 'live' | 'completed' | 'archived' | 'cancelled',
        cancelledAt: Date | null = null,
      ) => ({
        status,
        cancelledAt,
        disabledAt: null,
      });
      expect(passDisplay(active, guest, yes, ev('live'))).toBe('valid');
      expect(passDisplay(active, guest, yes, ev('completed'))).toBe('ended');
      expect(passDisplay(active, guest, yes, ev('archived'))).toBe('ended');
      expect(passDisplay(active, guest, yes, ev('cancelled', new Date()))).toBe('cancelled');
      expect(passDisplay(active, guest, yes, ev('archived', new Date()))).toBe('cancelled');
      expect(passDisplay({ status: 'revoked' }, guest, yes, ev('live'))).toBe('revoked');
      expect(expectedPartySize(guest, { status: 'confirmed', companionCount: 2 })).toBe(3);
      expect(
        expectedPartySize({ status: 'cancelled' }, { status: 'confirmed', companionCount: 2 }),
      ).toBe(0);
      expect(expectedPartySize(guest, { status: 'declined', companionCount: 0 })).toBe(0);
    });

    it('never holds two active passes for a guest, even if code tries', async () => {
      const { eventId, add } = await setup();
      const { guestId, token } = await add();
      await respondToInvitation(ctx, token, { status: 'confirmed', companions: 0 });
      await expect(
        ctx.db.insert(guestPasses).values({
          id: newId(),
          eventId,
          guestId,
          token: publicToken(),
          status: 'active',
          issuedAt: new Date(),
        }),
      ).rejects.toThrow();
      // A pass for a guest who hasn't confirmed is refused at commit.
      const other = await add();
      await expect(
        ctx.db.insert(guestPasses).values({
          id: newId(),
          eventId,
          guestId: other.guestId,
          token: publicToken(),
          status: 'active',
          issuedAt: new Date(),
        }),
      ).rejects.toThrow();
      // A revoked pass stays revoked.
      await respondToInvitation(ctx, token, { status: 'declined' });
      await expect(
        ctx.db
          .update(guestPasses)
          .set({ status: 'active', revokedAt: null, revokeReason: null })
          .where(eq(guestPasses.guestId, guestId)),
      ).rejects.toThrow();
    });

    it('does not delete a guest whose invitation left the platform', async () => {
      const { userId, eventId, add } = await setup();
      const shared = await add();
      await recordInvitationShare(ctx, userId, eventId, shared.guestId, 'copy_link');
      await expect(deleteGuest(ctx, userId, eventId, shared.guestId)).rejects.toEqual(
        code('guest_delete_not_allowed'),
      );
      const opened = await add();
      await recordInvitationOpen(ctx, opened.token);
      await expect(deleteGuest(ctx, userId, eventId, opened.guestId)).rejects.toEqual(
        code('guest_delete_not_allowed'),
      );
      const untouched = await add();
      await deleteGuest(ctx, userId, eventId, untouched.guestId);
      expect(await getGuestPage(ctx, untouched.token)).toBeNull();
    });
  });

  describe('concurrency', () => {
    it('two tabs confirming at once leave one answer, one pass and one history entry', async () => {
      const { add } = await setup();
      const { guestId, token } = await add();
      const results = await Promise.all(
        Array.from({ length: 6 }, () =>
          respondToInvitation(ctx, token, { status: 'confirmed', companions: 1 }),
        ),
      );
      expect(results.filter((r) => r.changed)).toHaveLength(1);
      expect(await passesOf(guestId)).toHaveLength(1);
      expect((await typesOf(guestId)).filter((t) => t.startsWith('rsvp.confirmed'))).toHaveLength(
        1,
      );
      expect(new Set(results.map((r) => r.pass?.id)).size).toBe(1);
    });

    it('guest and owner changing the answer at once end in a consistent state', async () => {
      const { userId, eventId, add } = await setup();
      for (let round = 0; round < 5; round++) {
        const { guestId, token } = await add();
        await Promise.allSettled([
          respondToInvitation(ctx, token, { status: 'confirmed', companions: 2 }),
          setGuestRsvp(ctx, userId, eventId, guestId, { status: 'declined' }),
          respondToInvitation(ctx, token, { status: 'confirmed', companions: 1 }),
        ]);
        const [answer] = await ctx.db.select().from(rsvps).where(eq(rsvps.guestId, guestId));
        const active = await ctx.db
          .select()
          .from(guestPasses)
          .where(and(eq(guestPasses.guestId, guestId), eq(guestPasses.status, 'active')));
        expect(active.length).toBe(answer!.status === 'confirmed' ? 1 : 0);
      }
    });

    it('an answer racing an event cancellation either lands first or is refused', async () => {
      const { userId, eventId, add } = await setup();
      const guestsAdded = await Promise.all([add(), add(), add(), add()]);
      const answers = guestsAdded.map((g) =>
        respondToInvitation(ctx, g.token, { status: 'confirmed', companions: 0 }).then(
          () => 'ok',
          (e: { code?: string }) => e.code,
        ),
      );
      const cancel = transitionEvent(ctx, userId, eventId, 'cancel', { reason: 'ظرف طارئ' });
      const outcomes = await Promise.all(answers);
      await cancel;
      for (const o of outcomes) expect(['ok', 'rsvp_closed']).toContain(o);
      for (const g of guestsAdded)
        expect((await getGuestPage(ctx, g.token))?.state).toBe('cancelled');
    });
  });

  describe('sharing', () => {
    it('prepares the WhatsApp message with the variables and the personal link', async () => {
      const { userId, eventId, add } = await setup();
      const { guestId, token } = await add({ fullName: 'سارة الحربي', phone: '0551234567' });
      const content = await getShareContent(ctx, userId, eventId, guestId);
      expect(content.link).toBe(`http://localhost:3000/i/${token}`);
      expect(content.text).toContain('سارة الحربي');
      expect(content.text).toContain(content.link);
      expect(content.text).not.toMatch(/\{[a-z_]+\}/);
      expect(content.waUrl).toBe(
        `https://wa.me/966551234567?text=${encodeURIComponent(content.text)}`,
      );
      // The link carries only the token.
      expect(content.link).not.toContain(guestId);
      expect(content.link).not.toContain(eventId);
      expect(content.link).not.toContain('551234567');
    });

    it('lets the owner edit the text, but never drop {link} or use unknown placeholders', async () => {
      const { userId, eventId } = await setup();
      expect((await getShareText(ctx, userId, eventId)).isDefault).toBe(true);
      await expect(
        saveShareText(ctx, userId, eventId, { body: 'أهلاً {guest_name}' }),
      ).rejects.toEqual(expect.objectContaining({ details: { fields: { body: 'missing_link' } } }));
      await expect(
        saveShareText(ctx, userId, eventId, { body: 'أهلاً {name} {link}' }),
      ).rejects.toEqual(
        expect.objectContaining({ details: { fields: { body: 'unknown_placeholder' } } }),
      );
      await saveShareText(ctx, userId, eventId, {
        body: 'حياك {guest_name}\r\n{event_name} {date} {time} {venue}\n{link}',
      });
      expect((await getShareText(ctx, userId, eventId)).body).toBe(
        'حياك {guest_name}\n{event_name} {date} {time} {venue}\n{link}',
      );
      const text = renderShareText(DEFAULT_SHARE_TEXT, {
        guestName: '{link}',
        eventName: 'حفل',
        startsAt: new Date('2034-02-01T17:00:00Z'),
        timezone: 'Asia/Riyadh',
        venueName: 'القاعة',
        link: 'https://x.sa/i/abc',
      });
      // A name that looks like a placeholder is inserted as text, not expanded.
      expect(text).toContain('السلام عليكم {link}');
      expect(text).toContain('8:00');
    });

    it('marks an invitation shared (not delivered) and keeps a count', async () => {
      const { userId, eventId, add } = await setup();
      const { guestId } = await add();
      expect(await recordInvitationShare(ctx, userId, eventId, guestId, 'whatsapp')).toEqual({
        first: true,
      });
      expect(await recordInvitationShare(ctx, userId, eventId, guestId, 'copy_link')).toEqual({
        first: false,
      });
      const view = await getGuestLifecycle(ctx, userId, eventId, guestId);
      expect(view.invitation).toMatchObject({
        deliveryStatus: 'shared',
        shareCount: 2,
        openedAt: null,
      });
      const list = await listGuests(ctx, userId, eventId, { invite: 'shared' });
      expect(list.rows.map((r) => r.id)).toEqual([guestId]);
    });

    it('does not share before the event is published or after it is cancelled', async () => {
      const { userId, eventId, add } = await setup({ activate: false });
      const { guestId } = await add();
      await expect(
        recordInvitationShare(ctx, userId, eventId, guestId, 'whatsapp'),
      ).rejects.toEqual(code('event_not_published'));
      await expect(exportInvitationLinks(ctx, userId, eventId)).rejects.toEqual(
        code('event_not_published'),
      );
    });

    it('walks the share queue one guest at a time', async () => {
      const { userId, eventId, add } = await setup();
      const a = await add();
      const b = await add();
      const c = await add();
      let q = await getShareQueue(ctx, userId, eventId);
      expect(q).toMatchObject({ total: 3, remaining: 2, canShare: true });
      expect(q.current?.guestId).toBe(a.guestId);
      await recordInvitationShare(ctx, userId, eventId, a.guestId, 'whatsapp');
      q = await getShareQueue(ctx, userId, eventId, { after: a.guestId });
      expect(q.current?.guestId).toBe(b.guestId);
      expect(q.counts).toMatchObject({ not_shared: 2, shared_not_opened: 1, all: 3 });
      // Skipping moves on without sharing.
      q = await getShareQueue(ctx, userId, eventId, { after: b.guestId });
      expect(q.current?.guestId).toBe(c.guestId);
      expect(q.remaining).toBe(0);
      q = await getShareQueue(ctx, userId, eventId, { filter: 'shared_not_opened' });
      expect(q.current?.guestId).toBe(a.guestId);
    });

    it('exports name, phone, link and group as text, safe to open in Excel', async () => {
      const { userId, eventId, add } = await setup();
      const { groupId } = await createGroup(ctx, userId, eventId, { name: 'العائلة' });
      const { token } = await add({
        fullName: '=HYPERLINK("http://evil")',
        phone: '0551234567',
        groupId,
      });
      const cancelled = await add();
      await cancelGuest(ctx, userId, eventId, cancelled.guestId);
      const { file, rows } = await exportInvitationLinks(ctx, userId, eventId);
      expect(rows).toBe(1);
      const sheet = readSpreadsheet(file);
      expect(sheet.rows[0]).toEqual(['اسم الضيف', 'الجوال', 'رابط الدعوة', 'المجموعة']);
      expect(sheet.rows[1]).toEqual([
        `'=HYPERLINK("http://evil")`,
        '+966551234567',
        `http://localhost:3000/i/${token}`,
        'العائلة',
      ]);
    });
  });

  describe('preview', () => {
    it('shows a real or sample guest without changing anything', async () => {
      const { userId, eventId, add } = await setup({ activate: false });
      const { guestId } = await add({ fullName: 'نورة' });
      const real = await getInvitationPreview(ctx, userId, eventId, { guestId });
      expect(real).toMatchObject({ sample: false, state: 'open', guest: { fullName: 'نورة' } });
      const sample = await getInvitationPreview(ctx, userId, eventId, { as: 'confirmed' });
      expect(sample).toMatchObject({ sample: true, rsvp: { status: 'confirmed' } });
      expect(sample.pass?.display).toBe('valid');
      const [inv] = await ctx.db.select().from(invitations).where(eq(invitations.guestId, guestId));
      expect(inv).toMatchObject({ openCount: 0, shareCount: 0 });
      const [answer] = await ctx.db.select().from(rsvps).where(eq(rsvps.guestId, guestId));
      expect(answer?.status).toBe('pending');
    });

    it('is only for the event owner', async () => {
      const { eventId } = await setup();
      const stranger = await createOwner(ctx);
      await expect(getInvitationPreview(ctx, stranger.userId, eventId)).rejects.toEqual(
        code('not_found'),
      );
      await expect(exportInvitationLinks(ctx, stranger.userId, eventId)).rejects.toEqual(
        code('not_found'),
      );
    });
  });

  it('summarises answers and expected attendance from active, confirmed guests only', async () => {
    const { userId, eventId, add } = await setup();
    const a = await add();
    const b = await add();
    const c = await add();
    await add();
    await respondToInvitation(ctx, a.token, { status: 'confirmed', companions: 2 });
    await respondToInvitation(ctx, b.token, { status: 'confirmed', companions: 0 });
    await respondToInvitation(ctx, c.token, { status: 'declined' });
    await recordInvitationShare(ctx, userId, eventId, a.guestId, 'whatsapp');
    expect(await rsvpSummary(ctx, userId, eventId)).toEqual({
      invited: 4,
      shared: 1,
      opened: 3,
      responded: 3,
      confirmed: 2,
      declined: 1,
      pending: 1,
      expectedAttendance: 4,
    });
    await cancelGuest(ctx, userId, eventId, a.guestId);
    expect((await rsvpSummary(ctx, userId, eventId)).expectedAttendance).toBe(1);
    const list = await listGuests(ctx, userId, eventId, { rsvp: 'confirmed' });
    expect(list.rows.map((r) => [r.rsvpStatus, r.companionCount])).toEqual([
      ['confirmed', 0],
      ['confirmed', 2],
    ]);
  });
});
