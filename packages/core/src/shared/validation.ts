import type { z } from 'zod';
import { DomainError } from './errors';

/** Parses input with a zod schema; failures become `validation_failed` with field codes. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const fields: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '_';
      fields[key] ??= issue.message;
    }
    throw new DomainError('validation_failed', 'Invalid input', { fields });
  }
  return result.data;
}
