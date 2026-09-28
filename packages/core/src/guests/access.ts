import type { EventAccess } from '../authorization/authorization';
import { requireEventAccess } from '../authorization/authorization';
import { isEditable } from '../events/lifecycle';
import type { DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';

/**
 * Guest management is owner-only. Guests can change while the event is draft, active or live
 * and not disabled; completed, cancelled and archived events keep their list as it was.
 */
export async function requireGuestManagement(
  db: DbOrTx,
  userId: string,
  eventId: string,
  opts: { forUpdate?: boolean } = {},
): Promise<EventAccess> {
  const access = await requireEventAccess(db, userId, eventId, 'guests.manage', opts);
  if (access.event.disabledAt) throw new DomainError('event_disabled');
  if (!isEditable(access.event)) {
    throw new DomainError('event_not_editable', undefined, { status: access.event.status });
  }
  return access;
}

/** Read access to the guest list (owner only in phase 2). */
export function requireGuestView(db: DbOrTx, userId: string, eventId: string) {
  return requireEventAccess(db, userId, eventId, 'guests.view');
}

/** Whether the owner may change guests of an event in this state (for the UI). */
export function guestsEditable(event: Parameters<typeof isEditable>[0]): boolean {
  return isEditable(event);
}
