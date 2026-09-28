import type { Database } from '@gp/db';
import type { AccountMailer } from '../identity/mailer';
import type { ObjectStorage } from '../storage/storage';

/** Dependencies every service receives. Passed explicitly so tests control each one. */
export interface CoreContext {
  db: Database;
  mailer: AccountMailer;
  /** Event images (cover, logo). */
  storage: ObjectStorage;
  /** 32-byte key for secrets stored encrypted at rest (TOTP secrets). */
  encryptionKey: Buffer;
  /** Base URL used in links sent by email, e.g. https://app.example.sa */
  appBaseUrl: string;
  now: () => Date;
}

/** Drizzle transaction handle, the type of `db.transaction`'s callback argument. */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbOrTx = Database | Tx;
