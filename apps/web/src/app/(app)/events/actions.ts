'use server';

import {
  addStaff,
  createEvent,
  type EventStatus,
  removeStaff,
  setSupervisor,
  TRANSITION_ACTIONS,
  type TransitionAction,
  transitionEvent,
  updateEvent,
} from '@gp/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type FormState, formObject, toFormState } from '@/lib/form';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

const LIFECYCLE_FIELDS = [
  'assumedDurationMin',
  'checkinClosesOffsetMin',
  'reopenWindowMin',
] as const;

/**
 * Maps the flat form to the domain input. The form asks "minutes before start", which the
 * domain stores as a negative offset. Checkboxes are absent when unchecked.
 */
function eventInputFromForm(data: FormData) {
  const f = formObject(data);
  const lifecycle: Record<string, unknown> = {
    autoOpenCheckin: f['lifecycle.autoOpenCheckin'] === 'on',
    autoCloseCheckin: f['lifecycle.autoCloseCheckin'] === 'on',
  };
  const before = f['lifecycle.checkinOpensBeforeMin'];
  if (before !== undefined && before.trim() !== '') {
    const n = Number(before);
    lifecycle.checkinOpensOffsetMin = Number.isFinite(n) ? -n : before;
  }
  for (const k of LIFECYCLE_FIELDS) {
    const v = f[`lifecycle.${k}`];
    if (v !== undefined && v.trim() !== '') lifecycle[k] = v;
  }
  return {
    category: f.category,
    type: f.type,
    name: f.name,
    startsAt: f.startsAt,
    endsAt: f.endsAt,
    timezone: f.timezone,
    city: f.city,
    venueName: f.venueName,
    address: f.address,
    mapsUrl: f.mapsUrl,
    description: f.description,
    defaultAllowedCompanions: f.defaultAllowedCompanions,
    lifecycle,
  };
}

/** Domain field paths → form field names, so errors land on the right input. */
function mapFieldErrors(state: FormState): FormState {
  if (!state.fields) return state;
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(state.fields)) {
    fields[k === 'lifecycle.checkinOpensOffsetMin' ? 'lifecycle.checkinOpensBeforeMin' : k] = v;
  }
  return { ...state, fields };
}

export async function createEventAction(_prev: FormState, data: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  let eventId: string;
  try {
    ({ eventId } = await createEvent(
      getCoreContext(),
      principal.user.id,
      eventInputFromForm(data),
    ));
  } catch (err) {
    return mapFieldErrors(toFormState(err, data));
  }
  redirect(`/events/${eventId}/created`);
}

export async function updateEventAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await updateEvent(getCoreContext(), principal.user.id, eventId, eventInputFromForm(data));
  } catch (err) {
    return mapFieldErrors(toFormState(err, data));
  }
  redirect(`/events/${eventId}`);
}

export async function transitionAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const f = formObject(data);
  const action = f.action as TransitionAction;
  if (!TRANSITION_ACTIONS.includes(action)) return { error: 'invalid_transition' };
  try {
    await transitionEvent(getCoreContext(), principal.user.id, eventId, action, {
      expectedStatus: f.expectedStatus as EventStatus,
      ...(f.reason !== undefined ? { reason: f.reason } : {}),
    });
  } catch (err) {
    return toFormState(err, data);
  }
  // The action buttons may be gone after the change (e.g. archived), so the confirmation
  // travels in the URL rather than in the form's state.
  redirect(`/events/${eventId}?done=${action}`);
}

export async function addStaffAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await addStaff(getCoreContext(), principal.user.id, eventId, formObject(data));
  } catch (err) {
    return toFormState(err, data);
  }
  revalidatePath(`/events/${eventId}`);
  return {};
}

export async function staffChangeAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const f = formObject(data);
  const ctx = getCoreContext();
  try {
    if (f.op === 'remove') {
      await removeStaff(ctx, principal.user.id, eventId, f.membershipId ?? '');
    } else {
      await setSupervisor(
        ctx,
        principal.user.id,
        eventId,
        f.membershipId ?? '',
        f.op === 'supervisor_on',
      );
    }
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`/events/${eventId}`);
  return {};
}
