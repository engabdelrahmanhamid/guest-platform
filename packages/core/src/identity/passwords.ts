import { hash, verify } from '@node-rs/argon2';

// argon2id with OWASP-recommended parameters (19 MiB, 2 iterations).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password).catch(() => false);
}

let dummyHash: Promise<string> | undefined;

/** Verifies against a throwaway hash so a missing account takes as long as a wrong password. */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password');
  await verifyPassword(await dummyHash, password);
}
