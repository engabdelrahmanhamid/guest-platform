import 'server-only';
import { isDomainError } from '@gp/core';
import { getLogger } from './server';

import type { FormState } from '@/components/forms';

export type { FormState };

/**
 * Turns a thrown error into form state. Domain errors carry codes the form translates;
 * anything else is logged (without the input) and shown as a generic error.
 */
export function toFormState(err: unknown, data?: FormData): FormState {
  const values = data ? echoValues(data) : undefined;
  if (isDomainError(err)) {
    const fields = err.details.fields as Record<string, string> | undefined;
    return { error: err.code, ...(fields ? { fields } : {}), ...(values ? { values } : {}) };
  }
  // Next.js uses thrown errors for redirect()/notFound(); let those through.
  if (err instanceof Error && 'digest' in err && String(err.digest).startsWith('NEXT_')) throw err;
  getLogger().error({ err }, 'unexpected error in form action');
  return { error: 'generic', ...(values ? { values } : {}) };
}

function echoValues(data: FormData): Record<string, string> {
  const out = formObject(data);
  for (const k of Object.keys(out)) if (/password|token|code/i.test(k)) delete out[k];
  return out;
}

export function formObject(data: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of data.entries()) if (typeof v === 'string') out[k] = v;
  return out;
}
