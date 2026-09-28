import { activity, eventMemberships } from '@gp/db/schema';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEvent, transitionEvent } from '../events/events';
import { createOwner, createTestContext, databaseUrl, eventInput } from '../testing/harness';
import { addStaff, listMemberships, removeStaff, setSupervisor } from './memberships';

const code = (c: string) => expect.objectContaining({ code: c });

describe.skipIf(!databaseUrl)('event memberships', () => {
  const ctx = createTestContext(new Date('2032-01-01T09:00:00Z'));

  async function setup() {
    const owner = await createOwner(ctx);
    const { eventId, ownerMembershipId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    return { owner, eventId, ownerMembershipId };
  }

  it('adds staff without a user account, with a normalized phone', async () => {
    const { owner, eventId, ownerMembershipId } = await setup();
    const { membershipId } = await addStaff(ctx, owner.userId, eventId, {
      displayName: 'خالد',
      phone: '0551234567',
    });
    const [m] = await ctx.db
      .select()
      .from(eventMemberships)
      .where(eq(eventMemberships.id, membershipId));
    expect(m).toMatchObject({
      role: 'staff',
      userId: null,
      status: 'invited',
      isSupervisor: false,
      phoneE164: '+966551234567',
      createdByMembershipId: ownerMembershipId,
    });
    await expect(
      addStaff(ctx, owner.userId, eventId, { displayName: 'x', phone: '123' }),
    ).rejects.toEqual(code('validation_failed'));
  });

  it('toggles supervisor on staff only, idempotently, with activity', async () => {
    const { owner, eventId, ownerMembershipId } = await setup();
    const { membershipId } = await addStaff(ctx, owner.userId, eventId, { displayName: 'منى' });
    expect(await setSupervisor(ctx, owner.userId, eventId, membershipId, true)).toEqual({
      changed: true,
    });
    expect(await setSupervisor(ctx, owner.userId, eventId, membershipId, true)).toEqual({
      changed: false,
    });
    expect(await setSupervisor(ctx, owner.userId, eventId, membershipId, false)).toEqual({
      changed: true,
    });
    await expect(
      setSupervisor(ctx, owner.userId, eventId, ownerMembershipId, true),
    ).rejects.toEqual(code('membership_not_staff'));

    const types = await ctx.db
      .select({ type: activity.type })
      .from(activity)
      .where(and(eq(activity.eventId, eventId)));
    expect(types.map((t) => t.type)).toEqual([
      'event.created',
      'event_member.added',
      'event_member.added',
      'event_member.supervisor_enabled',
      'event_member.supervisor_disabled',
    ]);
  });

  it('database rejects a supervisor owner even if the service were bypassed', async () => {
    const { ownerMembershipId } = await setup();
    await expect(
      ctx.db
        .update(eventMemberships)
        .set({ isSupervisor: true })
        .where(eq(eventMemberships.id, ownerMembershipId)),
    ).rejects.toMatchObject({ cause: { constraint: 'event_memberships_supervisor_only_staff' } });
  });

  it('soft-removes staff, keeping history; the owner cannot be removed', async () => {
    const { owner, eventId, ownerMembershipId } = await setup();
    const { membershipId } = await addStaff(ctx, owner.userId, eventId, {
      displayName: 'سعد',
      isSupervisor: 'on',
    });
    expect(await removeStaff(ctx, owner.userId, eventId, membershipId)).toEqual({ changed: true });
    expect(await removeStaff(ctx, owner.userId, eventId, membershipId)).toEqual({ changed: false });
    await expect(removeStaff(ctx, owner.userId, eventId, ownerMembershipId)).rejects.toEqual(
      code('cannot_remove_owner'),
    );
    await expect(setSupervisor(ctx, owner.userId, eventId, membershipId, false)).rejects.toEqual(
      code('membership_removed'),
    );

    const [m] = await ctx.db
      .select()
      .from(eventMemberships)
      .where(eq(eventMemberships.id, membershipId));
    expect(m).toMatchObject({ status: 'removed', removedByMembershipId: ownerMembershipId });
    expect(m?.removedAt).toBeInstanceOf(Date);
    expect((await listMemberships(ctx, owner.userId, eventId)).map((x) => x.id)).toEqual([
      ownerMembershipId,
    ]);
    expect(
      await listMemberships(ctx, owner.userId, eventId, { includeRemoved: true }),
    ).toHaveLength(2);
  });

  it('can’t change staff once the event is over', async () => {
    const { owner, eventId } = await setup();
    const { membershipId } = await addStaff(ctx, owner.userId, eventId, { displayName: 'ريم' });
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    await transitionEvent(ctx, owner.userId, eventId, 'cancel', { reason: 'إلغاء' });
    await expect(addStaff(ctx, owner.userId, eventId, { displayName: 'x' })).rejects.toEqual(
      code('event_not_editable'),
    );
    await expect(removeStaff(ctx, owner.userId, eventId, membershipId)).rejects.toEqual(
      code('event_not_editable'),
    );
  });

  it('a membership id from another event is not found', async () => {
    const a = await setup();
    const b = await setup();
    const { membershipId } = await addStaff(ctx, b.owner.userId, b.eventId, { displayName: 'x' });
    await expect(removeStaff(ctx, a.owner.userId, a.eventId, membershipId)).rejects.toEqual(
      code('not_found'),
    );
  });
});
