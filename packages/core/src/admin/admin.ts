import { adminAuditLog, events, platformSettings, users } from '@gp/db/schema';
import { desc, eq, ilike, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { recordActivity } from '../activity/activity';
import { requireAdmin } from '../authorization/authorization';
import type { Principal } from '../identity/auth';
import { revokeAllSessions } from '../identity/auth';
import { getAllSettings, isSettingKey, parseSettingValue } from '../settings/settings';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { parseInput } from '../shared/validation';

export const ADMIN_AUDIT_ACTIONS = [
  'admin.user_disabled',
  'admin.user_enabled',
  'admin.event_disabled',
  'admin.event_enabled',
  'admin.platform_setting_changed',
] as const;
export type AdminAuditAction = (typeof ADMIN_AUDIT_ACTIONS)[number];

interface Meta {
  userAgent?: string | undefined;
}

const reasonSchema = z
  .string({ message: 'required' })
  .trim()
  .min(1, { message: 'required' })
  .max(500, { message: 'too_long' });

async function audit(
  db: DbOrTx,
  adminUserId: string,
  entry: {
    action: AdminAuditAction;
    targetType: 'user' | 'event' | 'platform_setting';
    targetId: string;
    reason?: string | null;
    before: unknown;
    after: unknown;
  },
  meta: Meta,
) {
  await db.insert(adminAuditLog).values({
    adminUserId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    reason: entry.reason ?? null,
    before: entry.before,
    after: entry.after,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
  });
}

/** Disables or re-enables an account. Disabling signs the user out everywhere at once. */
export async function setUserDisabled(
  ctx: CoreContext,
  principal: Principal | null,
  targetUserId: string,
  disabled: boolean,
  reasonInput: unknown,
  meta: Meta = {},
): Promise<{ changed: boolean }> {
  const admin = requireAdmin(principal);
  const reason = parseInput(reasonSchema, reasonInput);
  if (admin.user.id === targetUserId) throw new DomainError('cannot_disable_self');
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [user] = await tx.select().from(users).where(eq(users.id, targetUserId)).for('update');
    if (!user) throw new DomainError('not_found');
    const before = user.status;
    const after = disabled ? 'disabled' : 'active';
    if (before === after) return { changed: false };
    await tx
      .update(users)
      .set({ status: after, disabledAt: disabled ? now : null, updatedAt: now })
      .where(eq(users.id, targetUserId));
    if (disabled) await revokeAllSessions(tx, targetUserId, now);
    await audit(
      tx,
      admin.user.id,
      {
        action: disabled ? 'admin.user_disabled' : 'admin.user_enabled',
        targetType: 'user',
        targetId: targetUserId,
        reason,
        before: { status: before },
        after: { status: after },
      },
      meta,
    );
    return { changed: true };
  });
}

/**
 * Disables or re-enables an event. A disabled event keeps its status; owners can read it but
 * can't change it, and the scheduler skips it.
 */
export async function setEventDisabled(
  ctx: CoreContext,
  principal: Principal | null,
  eventId: string,
  disabled: boolean,
  reasonInput: unknown,
  meta: Meta = {},
): Promise<{ changed: boolean }> {
  const admin = requireAdmin(principal);
  const reason = parseInput(reasonSchema, reasonInput);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
    if (!event) throw new DomainError('not_found');
    if ((event.disabledAt !== null) === disabled) return { changed: false };
    await tx
      .update(events)
      .set({
        disabledAt: disabled ? now : null,
        disabledReason: disabled ? reason : null,
        updatedAt: now,
      })
      .where(eq(events.id, eventId));
    await audit(
      tx,
      admin.user.id,
      {
        action: disabled ? 'admin.event_disabled' : 'admin.event_enabled',
        targetType: 'event',
        targetId: eventId,
        reason,
        before: { disabled: !disabled },
        after: { disabled },
      },
      meta,
    );
    return { changed: true };
  });
}

/**
 * Changes a platform setting. New values apply to events created afterwards; existing events
 * keep the values they stored. Writes both the admin audit entry and a platform activity row.
 */
export async function updatePlatformSetting(
  ctx: CoreContext,
  principal: Principal | null,
  key: string,
  rawValue: unknown,
  meta: Meta = {},
): Promise<{ changed: boolean }> {
  const admin = requireAdmin(principal);
  if (!isSettingKey(key)) throw new DomainError('unknown_setting', undefined, { key });
  const value = parseSettingValue(key, rawValue);
  const now = ctx.now();
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(platformSettings)
      .where(eq(platformSettings.key, key))
      .for('update');
    if (!row) throw new DomainError('unknown_setting', undefined, { key });
    if (JSON.stringify(row.value) === JSON.stringify(value)) return { changed: false };
    await tx
      .update(platformSettings)
      // A bare null would be SQL NULL; the column holds JSON, where null means "off".
      .set({
        value: value === null ? sql`'null'::jsonb` : value,
        updatedByUserId: admin.user.id,
        updatedAt: now,
      })
      .where(eq(platformSettings.key, key));
    await audit(
      tx,
      admin.user.id,
      {
        action: 'admin.platform_setting_changed',
        targetType: 'platform_setting',
        targetId: key,
        before: { value: row.value },
        after: { value },
      },
      meta,
    );
    await recordActivity(tx, {
      type: 'platform_setting.updated',
      actor: { type: 'admin', userId: admin.user.id },
      data: { key, before: row.value, after: value },
    });
    return { changed: true };
  });
}

export async function adminListSettings(ctx: CoreContext, principal: Principal | null) {
  requireAdmin(principal);
  return getAllSettings(ctx.db);
}

export async function adminListUsers(
  ctx: CoreContext,
  principal: Principal | null,
  opts: { search?: string; limit?: number } = {},
) {
  requireAdmin(principal);
  const q = opts.search?.trim().replace(/[\\%_]/g, '\\$&');
  return ctx.db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      platformRole: users.platformRole,
      status: users.status,
      emailVerifiedAt: users.emailVerifiedAt,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .where(q ? or(ilike(users.email, `%${q}%`), ilike(users.fullName, `%${q}%`)) : undefined)
    .orderBy(desc(users.createdAt))
    .limit(opts.limit ?? 100);
}

export async function adminListEvents(
  ctx: CoreContext,
  principal: Principal | null,
  opts: { limit?: number } = {},
) {
  requireAdmin(principal);
  return ctx.db
    .select({
      id: events.id,
      name: events.name,
      status: events.status,
      startsAt: events.startsAt,
      timezone: events.timezone,
      disabledAt: events.disabledAt,
      disabledReason: events.disabledReason,
      ownerEmail: users.email,
    })
    .from(events)
    .innerJoin(users, eq(users.id, events.createdByUserId))
    .orderBy(desc(events.createdAt))
    .limit(opts.limit ?? 100);
}

export async function adminListAudit(
  ctx: CoreContext,
  principal: Principal | null,
  opts: { limit?: number } = {},
) {
  requireAdmin(principal);
  return ctx.db
    .select()
    .from(adminAuditLog)
    .orderBy(desc(adminAuditLog.id))
    .limit(opts.limit ?? 100);
}

/**
 * Operator bootstrap: grants the admin role to an existing account. Run from the command line
 * only (`pnpm admin:grant <email>`); there is no web route to it.
 */
export async function grantPlatformAdmin(db: DbOrTx, email: string): Promise<string> {
  const [user] = await db
    .update(users)
    .set({ platformRole: 'admin', updatedAt: new Date() })
    .where(eq(users.email, email.trim().toLowerCase()))
    .returning({ id: users.id });
  if (!user) throw new DomainError('not_found');
  return user.id;
}
