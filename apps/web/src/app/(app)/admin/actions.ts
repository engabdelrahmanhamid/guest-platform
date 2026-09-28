'use server';

import {
  beginTotpEnrollment,
  confirmTotpEnrollment,
  type SettingKey,
  SETTING_SCHEMAS,
  setEventDisabled,
  setUserDisabled,
  updatePlatformSetting,
  verifyTotp,
} from '@gp/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type FormState, formObject, toFormState } from '@/lib/form';
import { getCoreContext } from '@/lib/server';
import { getPrincipal, requestMeta } from '@/lib/session';

async function adminPrincipal() {
  const principal = await getPrincipal();
  if (!principal) redirect('/login');
  if (principal.user.platformRole !== 'admin') redirect('/dashboard');
  return principal;
}

export async function beginMfaAction(_prev: FormState): Promise<FormState> {
  const principal = await adminPrincipal();
  try {
    const { secret, uri } = await beginTotpEnrollment(getCoreContext(), principal.user.id);
    return { ok: true, data: { secret, uri } };
  } catch (err) {
    return toFormState(err);
  }
}

export async function confirmMfaAction(prev: FormState, data: FormData): Promise<FormState> {
  const principal = await adminPrincipal();
  try {
    const code = String(data.get('code') ?? '');
    if (principal.user.totpEnabled) {
      await verifyTotp(getCoreContext(), principal.user.id, principal.session.id, code);
    } else {
      await confirmTotpEnrollment(getCoreContext(), principal.user.id, principal.session.id, code);
    }
  } catch (err) {
    // Keep the enrollment secret on screen after a wrong code.
    return { ...toFormState(err), ...(prev.data ? { data: prev.data } : {}) };
  }
  redirect('/admin');
}

/** Settings arrive as strings; booleans are checkboxes and an empty number means "off" (null). */
function parseSettingForm(key: SettingKey, raw: string | undefined): unknown {
  const sample = SETTING_SCHEMAS[key];
  if (sample.safeParse(true).success) return raw === 'on';
  if (raw === undefined || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : raw;
}

export async function updateSettingAction(_prev: FormState, data: FormData): Promise<FormState> {
  const principal = await adminPrincipal();
  const f = formObject(data);
  const key = f.key as SettingKey;
  if (!(key in SETTING_SCHEMAS)) return { error: 'unknown_setting' };
  try {
    await updatePlatformSetting(
      getCoreContext(),
      principal,
      key,
      parseSettingForm(key, f.value),
      await requestMeta(),
    );
  } catch (err) {
    const state = toFormState(err, data);
    return state.fields ? state : { ...state, fields: { value: 'invalid' } };
  }
  revalidatePath('/admin');
  return { ok: true, message: 'admin.saved' };
}

export async function toggleUserAction(_prev: FormState, data: FormData): Promise<FormState> {
  const principal = await adminPrincipal();
  const f = formObject(data);
  try {
    await setUserDisabled(
      getCoreContext(),
      principal,
      f.userId ?? '',
      f.op === 'disable',
      f.reason,
      await requestMeta(),
    );
  } catch (err) {
    return toFormState(err, data);
  }
  revalidatePath('/admin');
  return { ok: true, message: 'admin.saved' };
}

export async function toggleEventAction(_prev: FormState, data: FormData): Promise<FormState> {
  const principal = await adminPrincipal();
  const f = formObject(data);
  try {
    await setEventDisabled(
      getCoreContext(),
      principal,
      f.eventId ?? '',
      f.op === 'disable',
      f.reason,
      await requestMeta(),
    );
  } catch (err) {
    return toFormState(err, data);
  }
  revalidatePath('/admin');
  return { ok: true, message: 'admin.saved' };
}
