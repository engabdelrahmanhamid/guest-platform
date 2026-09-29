import 'server-only';
import {
  type DoorCaller,
  isDomainError,
  requireDoorAccess,
  STAFF_SESSION_MAX_AGE_SECONDS,
} from '@gp/core';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { getConfig, getCoreContext } from './server';
import { getPrincipal } from './session';

/**
 * The staff device cookie. It holds the session secret (the database has only its hash), is
 * http-only and same-site strict, and lives at most a week; the session itself ends sooner,
 * when check-in closes or the owner revokes it, and that is checked on every request.
 */
const STAFF_COOKIE = 'gp_staff';
const STAFF_COOKIE_MAX_AGE = STAFF_SESSION_MAX_AGE_SECONDS;

export async function setStaffCookie(sessionToken: string) {
  (await cookies()).set(STAFF_COOKIE, sessionToken, {
    httpOnly: true,
    secure: getConfig().NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: STAFF_COOKIE_MAX_AGE,
  });
}

export async function getStaffToken(): Promise<string | undefined> {
  return (await cookies()).get(STAFF_COOKIE)?.value;
}

export async function clearStaffCookie() {
  (await cookies()).delete(STAFF_COOKIE);
}

/**
 * Who is at this event's door: the staff device if its session is valid for this event,
 * otherwise the signed-in owner. Null when neither applies.
 */
export const resolveDoorCaller = cache(async (eventId: string): Promise<DoorCaller | null> => {
  const ctx = getCoreContext();
  const staffToken = await getStaffToken();
  if (staffToken) {
    const caller: DoorCaller = { kind: 'staff', sessionToken: staffToken };
    try {
      await requireDoorAccess(ctx.db, caller, eventId, 'scan', { now: ctx.now() });
      return caller;
    } catch (err) {
      if (!isDomainError(err)) throw err;
    }
  }
  const principal = await getPrincipal();
  return principal ? { kind: 'owner', userId: principal.user.id } : null;
});

/** "iPhone · Safari": enough for the owner to tell devices apart, nothing more. */
export async function deviceLabel(): Promise<string | null> {
  const ua = (await headers()).get('user-agent') ?? '';
  if (!ua) return null;
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows'
            : null;
  const browser = /SamsungBrowser/.test(ua)
    ? 'Samsung Internet'
    : /Edg\//.test(ua)
      ? 'Edge'
      : /CriOS|Chrome\//.test(ua)
        ? 'Chrome'
        : /FxiOS|Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  return [device, browser].filter(Boolean).join(' · ') || null;
}
