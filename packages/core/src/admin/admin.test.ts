import { activity, adminAuditLog, platformSettings } from '@gp/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createEvent, transitionEvent } from '../events/events';
import {
  createOwner,
  createTestContext,
  createVerifiedAdmin,
  databaseUrl,
  eventInput,
} from '../testing/harness';
import { setEventDisabled, setUserDisabled, updatePlatformSetting } from './admin';

const code = (c: string) => expect.objectContaining({ code: c });

describe.skipIf(!databaseUrl)('platform admin', () => {
  const ctx = createTestContext(new Date('2034-01-01T09:00:00Z'));

  async function auditFor(targetId: string) {
    return ctx.db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, targetId))
      .orderBy(adminAuditLog.id);
  }

  it('disables and re-enables a user, auditing both', async () => {
    const admin = await createVerifiedAdmin(ctx);
    const owner = await createOwner(ctx);
    await setUserDisabled(ctx, admin.principal, owner.userId, true, 'بلاغ', { userAgent: 'test' });
    expect(await setUserDisabled(ctx, admin.principal, owner.userId, true, 'بلاغ')).toEqual({
      changed: false,
    });
    await setUserDisabled(ctx, admin.principal, owner.userId, false, 'تمت المراجعة');
    const rows = await auditFor(owner.userId);
    expect(rows).toEqual([
      expect.objectContaining({
        adminUserId: admin.userId,
        action: 'admin.user_disabled',
        targetType: 'user',
        reason: 'بلاغ',
        before: { status: 'active' },
        after: { status: 'disabled' },
        userAgent: 'test',
      }),
      expect.objectContaining({ action: 'admin.user_enabled' }),
    ]);
    await expect(setUserDisabled(ctx, admin.principal, admin.userId, true, 'x')).rejects.toEqual(
      code('cannot_disable_self'),
    );
  });

  it('disabling an event blocks owner changes but keeps its status', async () => {
    const admin = await createVerifiedAdmin(ctx);
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    await setEventDisabled(ctx, admin.principal, eventId, true, 'محتوى مخالف');
    await expect(transitionEvent(ctx, owner.userId, eventId, 'activate')).rejects.toEqual(
      code('event_disabled'),
    );
    await setEventDisabled(ctx, admin.principal, eventId, false, 'تمت المعالجة');
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    expect((await auditFor(eventId)).map((r) => r.action)).toEqual([
      'admin.event_disabled',
      'admin.event_enabled',
    ]);
  });

  it('validates and audits setting changes, with a platform activity row', async () => {
    const admin = await createVerifiedAdmin(ctx);
    const key = 'retention.guest_pii_days';
    await expect(updatePlatformSetting(ctx, admin.principal, key, 0)).rejects.toEqual(
      code('validation_failed'),
    );
    await expect(updatePlatformSetting(ctx, admin.principal, 'no.such', 1)).rejects.toEqual(
      code('unknown_setting'),
    );

    const [current] = await ctx.db
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, key));
    const next = current?.value === 365 ? 366 : 365;
    await updatePlatformSetting(ctx, admin.principal, key, next);
    try {
      expect(await updatePlatformSetting(ctx, admin.principal, key, next)).toEqual({
        changed: false,
      });
      const [row] = await ctx.db
        .select()
        .from(platformSettings)
        .where(eq(platformSettings.key, key));
      expect(row).toMatchObject({ value: next, updatedByUserId: admin.userId });
      const [audit] = await ctx.db
        .select()
        .from(adminAuditLog)
        .where(and(eq(adminAuditLog.targetId, key), eq(adminAuditLog.adminUserId, admin.userId)));
      expect(audit).toMatchObject({
        action: 'admin.platform_setting_changed',
        before: { value: current?.value },
        after: { value: next },
      });
      const [act] = await ctx.db
        .select()
        .from(activity)
        .where(
          and(
            eq(activity.type, 'platform_setting.updated'),
            eq(activity.actorUserId, admin.userId),
          ),
        )
        .orderBy(desc(activity.id));
      expect(act).toMatchObject({
        actorType: 'admin',
        data: { key, before: current?.value, after: next },
      });
    } finally {
      await updatePlatformSetting(ctx, admin.principal, key, null);
    }
  });

  it('audit and activity rows cannot be edited or deleted', async () => {
    await expect(
      ctx.db.execute(sql`UPDATE admin_audit_log SET reason = 'x'`),
    ).rejects.toMatchObject({
      cause: { message: 'admin_audit_log is append-only' },
    });
    await expect(ctx.db.execute(sql`DELETE FROM activity`)).rejects.toMatchObject({
      cause: { message: 'activity is append-only' },
    });
  });
});
