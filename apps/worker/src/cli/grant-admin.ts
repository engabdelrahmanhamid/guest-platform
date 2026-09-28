import { createLogger, grantPlatformAdmin, isDomainError } from '@gp/core';
import { createDatabase, createPool } from '@gp/db';

// Operator bootstrap: pnpm admin:grant owner@example.sa
// The account must already exist. The admin then enrolls two-factor at /admin/mfa.
const log = createLogger({ name: 'grant-admin' });
const email = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!email || !databaseUrl) {
  log.error('usage: DATABASE_URL=… pnpm admin:grant <email>');
  process.exit(2);
}
const pool = createPool(databaseUrl, 1);
try {
  const userId = await grantPlatformAdmin(createDatabase(pool), email);
  log.info({ userId }, 'platform admin granted');
} catch (err) {
  log.error(isDomainError(err, 'not_found') ? 'no account with that email' : { err }, 'failed');
  process.exitCode = 1;
} finally {
  await pool.end();
}
