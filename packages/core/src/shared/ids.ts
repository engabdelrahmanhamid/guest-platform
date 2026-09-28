import { v7 } from 'uuid';

/** Time-ordered UUIDv7 for primary keys. Never exposed in public URLs. */
export function newId(): string {
  return v7();
}
