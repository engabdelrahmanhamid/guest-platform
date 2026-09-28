import { eventMemberships } from '@gp/db/schema';
import { describe, expect, it } from 'vitest';
import { adminListUsers, setEventDisabled, updatePlatformSetting } from '../admin/admin';
import { createEvent, getEventView, transitionEvent, updateEvent } from '../events/events';
import { addStaff, listMemberships, removeStaff } from '../memberships/memberships';
import { newId } from '../shared/ids';
import {
  createOwner,
  createTestContext,
  createVerifiedAdmin,
  databaseUrl,
  eventInput,
  principalFor,
} from '../testing/harness';
import { roleCan } from './authorization';

const code = (c: string) => expect.objectContaining({ code: c });

describe('role capabilities', () => {
  it('gives staff no owner capability', () => {
    expect(roleCan('staff', 'event.view')).toBe(true);
    for (const cap of [
      'event.edit',
      'event.transition',
      'members.manage',
      'members.view',
      'activity.view',
    ] as const) {
      expect(roleCan('staff', cap)).toBe(false);
      expect(roleCan('owner', cap)).toBe(true);
    }
  });
});

describe.skipIf(!databaseUrl)('authorization', () => {
  const ctx = createTestContext(new Date('2033-01-01T09:00:00Z'));

  it('hides other workspaces’ events: every owner operation is not_found', async () => {
    const a = await createOwner(ctx);
    const b = await createOwner(ctx);
    const { eventId, ownerMembershipId } = await createEvent(ctx, a.userId, eventInput(ctx));
    const attempts = [
      () => getEventView(ctx, b.userId, eventId),
      () => updateEvent(ctx, b.userId, eventId, eventInput(ctx)),
      () => transitionEvent(ctx, b.userId, eventId, 'activate'),
      () => addStaff(ctx, b.userId, eventId, { displayName: 'x' }),
      () => removeStaff(ctx, b.userId, eventId, ownerMembershipId),
      () => listMemberships(ctx, b.userId, eventId),
      () => getEventView(ctx, b.userId, newId()),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toEqual(code('not_found'));
  });

  it('lets a staff member view the event but do nothing an owner does', async () => {
    const owner = await createOwner(ctx);
    const staffUser = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    // Staff normally have no account (phase 4 adds passwordless access); link one to test the policy.
    await ctx.db.insert(eventMemberships).values({
      id: newId(),
      eventId,
      userId: staffUser.userId,
      role: 'staff',
      displayName: 'موظف',
      status: 'active',
    });
    const view = await getEventView(ctx, staffUser.userId, eventId);
    expect(view).toMatchObject({ allowedActions: [], canEdit: false, canManageMembers: false });
    for (const attempt of [
      () => updateEvent(ctx, staffUser.userId, eventId, eventInput(ctx)),
      () => transitionEvent(ctx, staffUser.userId, eventId, 'activate'),
      () => addStaff(ctx, staffUser.userId, eventId, { displayName: 'x' }),
      () => listMemberships(ctx, staffUser.userId, eventId),
    ]) {
      await expect(attempt()).rejects.toEqual(code('forbidden'));
    }
  });

  it('keeps platform admin and owner powers separate', async () => {
    const owner = await createOwner(ctx);
    const admin = await createVerifiedAdmin(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));

    // An admin has no owner access to someone else's event.
    await expect(getEventView(ctx, admin.userId, eventId)).rejects.toEqual(code('not_found'));
    await expect(transitionEvent(ctx, admin.userId, eventId, 'activate')).rejects.toEqual(
      code('not_found'),
    );

    // An owner can't use admin operations.
    const ownerPrincipal = await principalFor(ctx, owner.token);
    await expect(adminListUsers(ctx, ownerPrincipal)).rejects.toEqual(code('forbidden'));
    await expect(setEventDisabled(ctx, ownerPrincipal, eventId, true, 'x')).rejects.toEqual(
      code('forbidden'),
    );
    await expect(
      updatePlatformSetting(ctx, ownerPrincipal, 'retention.guest_pii_days', 30),
    ).rejects.toEqual(code('forbidden'));

    // The admin can.
    expect(
      (await adminListUsers(ctx, admin.principal, { search: owner.email })).map((u) => u.id),
    ).toEqual([owner.userId]);
  });
});
