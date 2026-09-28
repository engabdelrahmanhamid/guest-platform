import { createCipheriv, randomBytes } from 'node:crypto';
import type pg from 'pg';

/**
 * Step run by the migration runner before migration 0005 (token protection) is applied: encrypts
 * every invitation and pass token that is still stored in plain text and parks the ciphertext in
 * gp_sealed_tokens, where the migration picks it up. It does nothing once 0005 has run (the
 * plain-text columns are gone) or on an empty database.
 *
 * The ciphertext format and the row binding must match sealPublicToken in
 * packages/core/src/shared/tokens.ts; a core test checks that the two agree.
 */
export async function sealLegacyTokens(
  client: pg.PoolClient,
  readKey: () => Buffer,
): Promise<number> {
  const legacy = await client.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.columns
     WHERE table_schema = current_schema() AND column_name = 'token'
       AND table_name IN ('invitations', 'guest_passes')`,
  );
  if (legacy.rowCount === 0) return 0;

  const rows: { kind: 'invitation' | 'pass'; id: string; token: string }[] = [];
  for (const { table_name } of legacy.rows) {
    const kind = table_name === 'invitations' ? 'invitation' : 'pass';
    const found = await client.query<{ id: string; token: string }>(
      `SELECT id, token FROM ${table_name === 'invitations' ? 'invitations' : 'guest_passes'}`,
    );
    for (const r of found.rows) rows.push({ kind, id: r.id, token: r.token });
  }
  if (rows.length === 0) return 0;

  const key = readKey();
  await client.query(`CREATE TABLE IF NOT EXISTS gp_sealed_tokens (
    kind text NOT NULL, id uuid NOT NULL, token_enc bytea NOT NULL, PRIMARY KEY (kind, id))`);
  const batch = 1000;
  for (let i = 0; i < rows.length; i += batch) {
    const part = rows.slice(i, i + batch);
    await client.query(
      `INSERT INTO gp_sealed_tokens (kind, id, token_enc)
       SELECT * FROM unnest($1::text[], $2::uuid[], $3::bytea[])
       ON CONFLICT (kind, id) DO UPDATE SET token_enc = excluded.token_enc`,
      [
        part.map((r) => r.kind),
        part.map((r) => r.id),
        part.map((r) => sealLegacyToken(r.kind, r.id, r.token, key)),
      ],
    );
  }
  return rows.length;
}

/** AES-256-GCM, laid out as 12-byte IV, 16-byte tag, ciphertext (core/shared/crypto.ts). */
export function sealLegacyToken(
  kind: 'invitation' | 'pass',
  id: string,
  token: string,
  key: Buffer,
): Buffer {
  const aad = `gp.public-token:${kind}:${id}`;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** APP_ENCRYPTION_KEY, as the app reads it: base64 of 32 bytes. */
export function encryptionKeyFromEnv(env: NodeJS.ProcessEnv = process.env): Buffer {
  const key = Buffer.from(env.APP_ENCRYPTION_KEY ?? '', 'base64');
  if (key.length !== 32) {
    throw new Error(
      'APP_ENCRYPTION_KEY (base64 of 32 bytes) is required to encrypt existing invitation and pass tokens',
    );
  }
  return key;
}
