import { workspaceMembers, workspaces } from '@gp/db/schema';
import { and, eq } from 'drizzle-orm';
import { recordActivity } from '../activity/activity';
import { DomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import type { DbOrTx } from '../shared/context';

/** Creates the hidden personal workspace and its owner membership. Call inside sign-up's transaction. */
export async function createPersonalWorkspace(
  tx: DbOrTx,
  user: { id: string; fullName: string },
  now: Date,
): Promise<string> {
  const workspaceId = newId();
  await tx.insert(workspaces).values({
    id: workspaceId,
    kind: 'personal',
    name: user.fullName,
    createdByUserId: user.id,
    createdAt: now,
    updatedAt: now,
  });
  await tx
    .insert(workspaceMembers)
    .values({ workspaceId, userId: user.id, role: 'owner', createdAt: now });
  await recordActivity(tx, {
    type: 'workspace.created',
    actor: { type: 'user', userId: user.id },
    workspaceId,
    data: { kind: 'personal' },
  });
  return workspaceId;
}

export async function getPersonalWorkspaceId(db: DbOrTx, userId: string): Promise<string> {
  const [row] = await db
    .select({ id: workspaces.id })
    .from(workspaces)
    .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(
      and(
        eq(workspaces.kind, 'personal'),
        eq(workspaces.createdByUserId, userId),
        eq(workspaceMembers.userId, userId),
      ),
    );
  if (!row) throw new DomainError('not_found', 'Personal workspace missing');
  return row.id;
}

/** Throws `forbidden` unless the user owns the workspace. */
export async function assertWorkspaceOwner(
  db: DbOrTx,
  workspaceId: string,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  if (row?.role !== 'owner') throw new DomainError('forbidden');
}
