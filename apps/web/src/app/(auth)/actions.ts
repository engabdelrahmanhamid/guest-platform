'use server';

import {
  login,
  requestPasswordReset,
  resendEmailVerification,
  resetPassword,
  signUp,
  logout,
} from '@gp/core';
import { redirect } from 'next/navigation';
import { type FormState, formObject, toFormState } from '@/lib/form';
import { getCoreContext } from '@/lib/server';
import {
  clearSessionCookie,
  getPrincipal,
  getSessionToken,
  requestMeta,
  setSessionCookie,
} from '@/lib/session';

export async function signUpAction(_prev: FormState, data: FormData): Promise<FormState> {
  try {
    const { session } = await signUp(getCoreContext(), formObject(data), await requestMeta());
    await setSessionCookie(session.token, session.expiresAt);
  } catch (err) {
    return toFormState(err, data);
  }
  redirect('/dashboard');
}

export async function loginAction(_prev: FormState, data: FormData): Promise<FormState> {
  let destination: string;
  try {
    const res = await login(getCoreContext(), formObject(data), await requestMeta());
    await setSessionCookie(res.session.token, res.session.expiresAt);
    destination = res.mfaRequired ? '/admin/mfa' : '/dashboard';
  } catch (err) {
    return toFormState(err, data);
  }
  redirect(destination);
}

export async function logoutAction(): Promise<void> {
  const token = await getSessionToken();
  if (token) await logout(getCoreContext(), token);
  await clearSessionCookie();
  redirect('/login');
}

export async function forgotPasswordAction(_prev: FormState, data: FormData): Promise<FormState> {
  try {
    await requestPasswordReset(getCoreContext(), formObject(data), await requestMeta());
    return { ok: true, message: 'auth.forgotSent' };
  } catch (err) {
    return toFormState(err, data);
  }
}

export async function resetPasswordAction(_prev: FormState, data: FormData): Promise<FormState> {
  try {
    await resetPassword(getCoreContext(), formObject(data));
    await clearSessionCookie();
    return { ok: true, message: 'auth.resetDone' };
  } catch (err) {
    return toFormState(err, data);
  }
}

export async function resendVerificationAction(_prev: FormState): Promise<FormState> {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  try {
    await resendEmailVerification(getCoreContext(), principal.user.id);
    return { ok: true, message: 'auth.verifyResent' };
  } catch (err) {
    return toFormState(err);
  }
}
