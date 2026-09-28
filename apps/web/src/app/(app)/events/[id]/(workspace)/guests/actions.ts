'use server';

import {
  addGuest,
  bulkAssignGroup,
  bulkCancel,
  bulkSetCompanions,
  cancelGuest,
  commitImport,
  createGroup,
  createImportBatch,
  deleteGroup,
  deleteGuest,
  discardImport,
  isDomainError,
  moveGroup,
  renameGroup,
  restoreGuest,
  setImportDecisions,
  updateGuest,
} from '@gp/core';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { type FormState, formObject, toFormState } from '@/lib/form';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

const base = (eventId: string) => `/events/${eventId}/guests`;

/** Where to go after an action: the page the form came from, if it is this event's guests. */
function back(eventId: string, data: FormData, extra: Record<string, string | null> = {}): string {
  const raw = data.get('returnTo');
  const from = typeof raw === 'string' && raw.startsWith(base(eventId)) ? raw : base(eventId);
  const url = new URL(from, 'http://x');
  for (const [k, v] of Object.entries(extra)) {
    if (v === null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
  return `${url.pathname}${url.search}`;
}

function refresh(eventId: string) {
  revalidatePath(`/events/${eventId}`, 'layout');
}

function guestInput(data: FormData) {
  const f = formObject(data);
  return {
    fullName: f.fullName,
    phone: f.phone,
    email: f.email,
    groupId: f.groupId,
    allowedCompanions: f.allowedCompanions,
    notes: f.notes,
    allowDuplicate: f.allowDuplicate,
  };
}

/** Save result for the duplicate warning: the matches go back to the form to show. */
function duplicateState(data: FormData, duplicates: unknown): FormState {
  return {
    error: 'duplicate_phone',
    values: formObject(data),
    data: { duplicates: JSON.stringify(duplicates) },
  };
}

export async function addGuestAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  let guestId: string;
  try {
    const result = await addGuest(getCoreContext(), principal.user.id, eventId, guestInput(data));
    if (result.status === 'duplicate') return duplicateState(data, result.duplicates);
    guestId = result.guestId;
  } catch (err) {
    return toFormState(err, data);
  }
  refresh(eventId);
  if (data.get('intent') === 'another') {
    // Stay on the form, cleared, keeping the chosen group for the next guest.
    return {
      ok: true,
      message: 'guests.form.addedAnother',
      data: { groupId: String(data.get('groupId') ?? '') },
    };
  }
  redirect(back(eventId, data, { panel: null, guest: guestId, done: 'added' }));
}

export async function updateGuestAction(
  eventId: string,
  guestId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    const result = await updateGuest(
      getCoreContext(),
      principal.user.id,
      eventId,
      guestId,
      guestInput(data),
    );
    if (result.status === 'duplicate') return duplicateState(data, result.duplicates);
  } catch (err) {
    return toFormState(err, data);
  }
  refresh(eventId);
  redirect(back(eventId, data, { panel: null, guest: guestId, done: 'updated' }));
}

export async function guestStatusAction(
  eventId: string,
  guestId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const ctx = getCoreContext();
  const op = data.get('op');
  try {
    if (op === 'cancel')
      await cancelGuest(ctx, principal.user.id, eventId, guestId, { reason: data.get('reason') });
    else if (op === 'restore') await restoreGuest(ctx, principal.user.id, eventId, guestId);
    else if (op === 'delete') await deleteGuest(ctx, principal.user.id, eventId, guestId);
    else return { error: 'generic' };
  } catch (err) {
    return toFormState(err, data);
  }
  refresh(eventId);
  redirect(
    op === 'delete'
      ? back(eventId, data, { guest: null, panel: null, done: 'deleted' })
      : back(eventId, data, { panel: null, done: op === 'cancel' ? 'cancelled' : 'restored' }),
  );
}

export async function bulkAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const ctx = getCoreContext();
  const ids = data.getAll('ids').map(String);
  const op = data.get('op');
  let done: string;
  try {
    if (op === 'group') {
      const g = String(data.get('bulkGroup') ?? '');
      await bulkAssignGroup(
        ctx,
        principal.user.id,
        eventId,
        ids,
        g === 'none' || g === '' ? null : g,
      );
      done = 'bulkGroup';
    } else if (op === 'companions') {
      await bulkSetCompanions(ctx, principal.user.id, eventId, ids, data.get('bulkCompanions'));
      done = 'bulkCompanions';
    } else if (op === 'cancel') {
      await bulkCancel(ctx, principal.user.id, eventId, ids, { reason: data.get('bulkReason') });
      done = 'bulkCancelled';
    } else return { error: 'generic' };
  } catch (err) {
    return toFormState(err);
  }
  refresh(eventId);
  redirect(back(eventId, data, { done, n: String(ids.length) }));
}

export async function groupAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const ctx = getCoreContext();
  const op = data.get('op');
  const groupId = String(data.get('groupId') ?? '');
  try {
    if (op === 'create')
      await createGroup(ctx, principal.user.id, eventId, { name: data.get('name') });
    else if (op === 'rename')
      await renameGroup(ctx, principal.user.id, eventId, groupId, { name: data.get('name') });
    else if (op === 'up' || op === 'down')
      await moveGroup(ctx, principal.user.id, eventId, groupId, op);
    else if (op === 'delete') await deleteGroup(ctx, principal.user.id, eventId, groupId);
    else return { error: 'generic' };
  } catch (err) {
    return toFormState(err, op === 'create' || op === 'rename' ? data : undefined);
  }
  refresh(eventId);
  return { ok: true, message: `guests.groups.done.${String(op)}` };
}

/* Import ------------------------------------------------------------------------------------ */

export async function uploadImportAction(
  eventId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const file = data.get('file');
  if (!(file instanceof File) || file.size === 0) return { error: 'file_missing' };
  let batchId: string;
  try {
    ({ batchId } = await createImportBatch(getCoreContext(), principal.user.id, eventId, {
      name: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }));
  } catch (err) {
    return toFormState(err);
  }
  redirect(`${base(eventId)}/import/${batchId}`);
}

export async function importDecisionAction(
  eventId: string,
  batchId: string,
  _prev: FormState,
  data: FormData,
): Promise<FormState> {
  const principal = await requirePrincipal();
  const ctx = getCoreContext();
  // "skip:row:<id>" decides one row; "skip:undecided" decides every row still waiting.
  const [decision, target, rowId] = String(data.get('decide') ?? '').split(':');
  try {
    await setImportDecisions(
      ctx,
      principal.user.id,
      eventId,
      batchId,
      target === 'row'
        ? { rowIds: [rowId ?? ''] }
        : { filter: target === 'needs_review' ? 'needs_review' : 'undecided' },
      decision ?? '',
    );
  } catch (err) {
    return toFormState(err);
  }
  revalidatePath(`${base(eventId)}/import/${batchId}`);
  return { ok: true };
}

export async function commitImportAction(
  eventId: string,
  batchId: string,
  _prev: FormState,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    const result = await commitImport(getCoreContext(), principal.user.id, eventId, batchId);
    if (result.status === 'changed') {
      revalidatePath(`${base(eventId)}/import/${batchId}`);
      return { error: 'import_changed', data: { n: String(result.rowsChanged) } };
    }
  } catch (err) {
    if (isDomainError(err, 'import_not_ready')) redirect(`${base(eventId)}/import/${batchId}`);
    return toFormState(err);
  }
  refresh(eventId);
  redirect(`${base(eventId)}/import/${batchId}`);
}

export async function discardImportAction(
  eventId: string,
  batchId: string,
  _prev: FormState,
): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await discardImport(getCoreContext(), principal.user.id, eventId, batchId);
  } catch (err) {
    return toFormState(err);
  }
  redirect(`${base(eventId)}/import`);
}
