'use server';

import {
  checkIn,
  confirmAtDoor,
  correctAttendance,
  type DoorCaller,
  type DoorGuest,
  type DoorOverview,
  type DoorSearchRow,
  getDoorGuest,
  getDoorOverview,
  isDomainError,
  listDoorTeam,
  lookupQr,
  revokeStaffAccess,
  sendStaffAccess,
  whatsappUrl,
  type DoorTeamMember,
  type QrLookup,
  registerWalkIn,
  searchDoor,
  signOutStaff,
  type WalkInResult,
  type DoorWriteResult,
} from '@gp/core';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { clearStaffCookie, getStaffToken, resolveDoorCaller } from '@/lib/door';
import { getCoreContext, getLogger } from '@/lib/server';

/**
 * The scanner's calls. Each one resolves who is at the door for this event (the staff device's
 * session, or the signed-in owner) and runs the core operation; errors come back as codes the
 * scanner translates. Writes carry the client's idempotency key, so a retry after a dropped
 * connection can never admit twice.
 */
export type DoorResult<T> =
  { ok: true; data: T } | { ok: false; error: string; details?: Record<string, unknown> };

async function door<T>(
  eventId: string,
  run: (caller: DoorCaller) => Promise<T>,
): Promise<DoorResult<T>> {
  try {
    const caller = await resolveDoorCaller(eventId);
    if (!caller) return { ok: false, error: 'staff_session_invalid' };
    return { ok: true, data: await run(caller) };
  } catch (err) {
    if (isDomainError(err)) {
      const { fields, ...rest } = err.details as Record<string, unknown>;
      return {
        ok: false,
        error: err.code,
        details: fields ? { ...rest, fields } : rest,
      };
    }
    getLogger().error({ err }, 'door action failed');
    return { ok: false, error: 'generic' };
  }
}

export async function overviewAction(eventId: string): Promise<DoorResult<DoorOverview>> {
  return door(eventId, (c) => getDoorOverview(getCoreContext(), c, eventId));
}

export async function lookupAction(
  eventId: string,
  payload: string,
): Promise<DoorResult<QrLookup>> {
  return door(eventId, (c) => lookupQr(getCoreContext(), c, eventId, String(payload)));
}

export async function searchAction(
  eventId: string,
  query: string,
): Promise<DoorResult<DoorSearchRow[]>> {
  return door(eventId, (c) => searchDoor(getCoreContext(), c, eventId, String(query)));
}

export async function guestAction(
  eventId: string,
  guestId: string,
): Promise<DoorResult<DoorGuest>> {
  return door(eventId, (c) => getDoorGuest(getCoreContext(), c, eventId, String(guestId)));
}

export async function checkInAction(
  eventId: string,
  input: {
    guestId: string;
    count: number;
    method: 'qr' | 'search';
    passId?: string;
    idempotencyKey: string;
  },
): Promise<DoorResult<DoorWriteResult>> {
  return door(eventId, (c) => checkIn(getCoreContext(), c, eventId, input));
}

export async function correctAction(
  eventId: string,
  input: { guestId: string; delta: number; reason: string; idempotencyKey: string },
): Promise<DoorResult<DoorWriteResult>> {
  return door(eventId, (c) => correctAttendance(getCoreContext(), c, eventId, input));
}

export async function confirmAction(
  eventId: string,
  guestId: string,
  companions: number,
): Promise<DoorResult<DoorWriteResult>> {
  return door(eventId, (c) =>
    confirmAtDoor(getCoreContext(), c, eventId, String(guestId), Number(companions)),
  );
}

export async function walkInAction(
  eventId: string,
  input: {
    fullName: string;
    phone: string;
    partySize: number;
    allowDuplicate: boolean;
    idempotencyKey: string;
  },
): Promise<DoorResult<WalkInResult>> {
  return door(eventId, (c) => registerWalkIn(getCoreContext(), c, eventId, input));
}

export async function teamAction(eventId: string): Promise<DoorResult<DoorTeamMember[]>> {
  return door(eventId, (c) => listDoorTeam(getCoreContext(), c, eventId));
}

/** A supervisor re-sends a colleague's access link; it is returned once, to share. */
export async function resendAction(
  eventId: string,
  membershipId: string,
): Promise<DoorResult<{ url: string; waUrl: string | null; name: string }>> {
  return door(eventId, async (c) => {
    const ctx = getCoreContext();
    const sent = await sendStaffAccess(ctx, c, eventId, String(membershipId));
    const overview = await getDoorOverview(ctx, c, eventId).catch(() => null);
    const t = await getTranslations('checkin.team');
    const text = t('shareText', {
      name: sent.staffName,
      event: overview?.event.name ?? '',
      url: sent.url,
    });
    return { url: sent.url, waUrl: whatsappUrl(sent.staffPhone, text), name: sent.staffName };
  });
}

export async function revokeAction(
  eventId: string,
  membershipId: string,
): Promise<DoorResult<{ changed: boolean }>> {
  return door(eventId, (c) =>
    revokeStaffAccess(getCoreContext(), c, eventId, String(membershipId)),
  );
}

/** Signs this staff device out and forgets its cookie. The owner signs out of their account instead. */
export async function signOutAction() {
  const token = await getStaffToken();
  if (token) await signOutStaff(getCoreContext(), token);
  await clearStaffCookie();
  redirect('/scan');
}
