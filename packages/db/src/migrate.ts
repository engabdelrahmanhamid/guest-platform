import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { encryptionKeyFromEnv, sealLegacyTokens } from './seal-legacy-tokens';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  // Before migration 0005 drops plain-text tokens, encrypt the ones that exist (see that file).
  const client = await pool.connect();
  try {
    const sealed = await sealLegacyTokens(client, () => encryptionKeyFromEnv());
    if (sealed > 0) process.stdout.write(`Encrypted ${sealed} existing public tokens\n`);
  } finally {
    client.release();
  }
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
  process.stdout.write('Migrations applied\n');
} finally {
  await pool.end();
}
