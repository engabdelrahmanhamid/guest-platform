import { guestPasses } from '@gp/db/schema';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ActivityInput, Actor } from '../activity/activity';
import type { DbOrTx } from '../shared/context';
import { newId } from '../shared/ids';
import { openPublicToken, publicToken, sealPublicToken } from '../shared/tokens';

export type PassRow = typeof guestPasses.$inferSelect;
export type PassRevokeReason = 'declined' | 'guest_cancelled' | 'replaced';
/** Why a pass was issued, for the guest's timeline. */
export type PassIssueReason = 'confirmed' | 'restored' | 'replaced';

interface GuestRef {
  id: string;
  eventId: string;
}

interface Scope {
  actor: Actor;
  workspaceId: string;
  now: Date;
}

/** The pass's token, decrypted, for drawing its QR. */
export function passToken(pass: PassRow, key: Buffer): string {
  return openPublicToken('pass', pass.id, pass, key);
}

export async function activePass(db: DbOrTx, guestId: string): Promise<PassRow | null> {
  const [p] = await db
    .select()
    .from(guestPasses)
    .where(and(eq(guestPasses.guestId, guestId), eq(guestPasses.status, 'active')));
  return p ?? null;
}

/** The guest's passes, newest first (the drawer shows the latest and how many came before). */
export async function passHistory(db: DbOrTx, guestId: string): Promise<PassRow[]> {
  return db
    .select()
    .from(guestPasses)
    .where(eq(guestPasses.guestId, guestId))
    .orderBy(desc(guestPasses.issuedAt), desc(guestPasses.id));
}

/**
 * Issues a new active pass with a fresh token. Callers hold the guest lock and have revoked any
 * active pass first; the unique index on active passes backs this up.
 */
export async function issuePass(
  tx: DbOrTx,
  guest: GuestRef,
  reason: PassIssueReason,
  scope: Scope & { key: Buffer },
): Promise<{ pass: PassRow; activity: ActivityInput }> {
  const id = newId();
  const [pass] = await tx
    .insert(guestPasses)
    .values({
      id,
      eventId: guest.eventId,
      guestId: guest.id,
      ...sealPublicToken('pass', id, publicToken(), scope.key),
      status: 'active',
      issuedAt: scope.now,
    })
    .returning();
  return {
    pass: pass!,
    activity: {
      type: 'pass.issued',
      actor: scope.actor,
      eventId: guest.eventId,
      workspaceId: scope.workspaceId,
      guestId: guest.id,
      data: { passId: pass!.id, reason },
    },
  };
}

/** Revokes the guest's active pass, if any. The row stays for history. */
export async function revokeActivePass(
  tx: DbOrTx,
  guest: GuestRef,
  reason: PassRevokeReason,
  scope: Scope,
  replacedByPassId: string | null = null,
): Promise<{ pass: PassRow | null; activity: ActivityInput | null }> {
  const [pass] = await tx
    .update(guestPasses)
    .set({ status: 'revoked', revokedAt: scope.now, revokeReason: reason, replacedByPassId })
    .where(and(eq(guestPasses.guestId, guest.id), eq(guestPasses.status, 'active')))
    .returning();
  if (!pass) return { pass: null, activity: null };
  return {
    pass,
    activity: {
      type: 'pass.revoked',
      actor: scope.actor,
      eventId: guest.eventId,
      workspaceId: scope.workspaceId,
      guestId: guest.id,
      data: { passId: pass.id, reason },
    },
  };
}

/** Revokes the active passes of many guests at once (bulk cancel). Guests are already locked. */
export async function revokeActivePasses(
  tx: DbOrTx,
  eventId: string,
  guestIds: string[],
  reason: PassRevokeReason,
  scope: Scope,
): Promise<ActivityInput[]> {
  if (!guestIds.length) return [];
  const revoked = await tx
    .update(guestPasses)
    .set({ status: 'revoked', revokedAt: scope.now, revokeReason: reason })
    .where(
      and(
        eq(guestPasses.eventId, eventId),
        inArray(guestPasses.guestId, guestIds),
        eq(guestPasses.status, 'active'),
      ),
    )
    .returning({ id: guestPasses.id, guestId: guestPasses.guestId });
  return revoked.map((p) => ({
    type: 'pass.revoked' as const,
    actor: scope.actor,
    eventId,
    workspaceId: scope.workspaceId,
    guestId: p.guestId,
    data: { passId: p.id, reason, bulk: true },
  }));
}

/**
 * Replaces the active pass (for example, a QR screenshot went further than it should): the old
 * pass is revoked and points at the new one, in the caller's transaction.
 */
export async function replaceActivePass(
  tx: DbOrTx,
  guest: GuestRef,
  scope: Scope & { key: Buffer },
): Promise<{ pass: PassRow; activities: ActivityInput[] } | null> {
  const current = await activePass(tx, guest.id);
  if (!current) return null;
  // Revoke first (the one-active index), then issue, then link the old pass to the new one.
  await tx
    .update(guestPasses)
    .set({ status: 'revoked', revokedAt: scope.now, revokeReason: 'replaced' })
    .where(eq(guestPasses.id, current.id));
  const issued = await issuePass(tx, guest, 'replaced', scope);
  await tx
    .update(guestPasses)
    .set({ replacedByPassId: issued.pass.id })
    .where(eq(guestPasses.id, current.id));
  return {
    pass: issued.pass,
    activities: [
      {
        type: 'pass.replaced',
        actor: scope.actor,
        eventId: guest.eventId,
        workspaceId: scope.workspaceId,
        guestId: guest.id,
        data: { fromPassId: current.id, toPassId: issued.pass.id },
      },
    ],
  };
}
