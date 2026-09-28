import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema/index';

export type Database = NodePgDatabase<typeof schema>;

export function createPool(databaseUrl: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool, { schema });
}

/** Round-trip check used by health endpoints. */
export async function pingDatabase(pool: pg.Pool): Promise<void> {
  await pool.query('select 1');
}
