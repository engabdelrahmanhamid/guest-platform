import { invitations, rsvps } from '@gp/db/schema';
import type { ActivityInput, Actor } from '../activity/activity';
import type { DbOrTx } from '../shared/context';
import { newId } from '../shared/ids';
import { publicToken } from '../shared/tokens';

/**
 * Every guest gets a personal invitation link and a pending answer when they are created, in the
 * same transaction, so a link exists even if nothing is ever sent. Returns the activity entries
 * for the caller to record with its own.
 */
export async function createGuestLifecycle(
  tx: DbOrTx,
  guestsCreated: { id: string; eventId: string }[],
  scope: { actor: Actor; workspaceId: string; now: Date },
): Promise<ActivityInput[]> {
  const entries: ActivityInput[] = [];
  for (let i = 0; i < guestsCreated.length; i += 1000) {
    const chunk = guestsCreated.slice(i, i + 1000);
    if (!chunk.length) continue;
    await tx.insert(invitations).values(
      chunk.map((g) => ({
        id: newId(),
        eventId: g.eventId,
        guestId: g.id,
        token: publicToken(),
        createdAt: scope.now,
        updatedAt: scope.now,
      })),
    );
    await tx.insert(rsvps).values(
      chunk.map((g) => ({
        id: newId(),
        eventId: g.eventId,
        guestId: g.id,
        createdAt: scope.now,
        updatedAt: scope.now,
      })),
    );
    for (const g of chunk) {
      entries.push({
        type: 'invitation.created',
        actor: scope.actor,
        eventId: g.eventId,
        workspaceId: scope.workspaceId,
        guestId: g.id,
      });
    }
  }
  return entries;
}
