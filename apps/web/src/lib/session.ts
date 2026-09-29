import 'server-only';
import { clientIp, type Principal, validateSession } from '@gp/core';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getConfig, getCoreContext } from './server';

const COOKIE = 'gp_session';

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: getConfig().NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(COOKIE);
}

export async function getSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(COOKIE)?.value;
}

/** The signed-in principal for this request, or null. Checked against the database every request. */
export const getPrincipal = cache(async (): Promise<Principal | null> => {
  const token = await getSessionToken();
  return token ? validateSession(getCoreContext(), token) : null;
});

export async function requirePrincipal(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  return principal;
}

/** Admin pages: signed in, admin role, and the second factor passed on this session. */
export async function requireAdminPage(): Promise<Principal> {
  const principal = await requirePrincipal();
  if (principal.user.platformRole !== 'admin') redirect('/dashboard');
  if (!principal.session.mfaVerified) redirect('/admin/mfa');
  return principal;
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: clientIp(h.get('x-forwarded-for'), getConfig().TRUSTED_PROXY_HOPS),
    userAgent: h.get('user-agent') ?? undefined,
  };
}
