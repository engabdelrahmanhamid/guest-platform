import pg from 'pg';
import { describe, expect, it } from 'vitest';

// Runs against the database CI migrates before tests. Skipped when no database is configured.
const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)('initial migration', () => {
  it('installs the extensions the schema relies on', async () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
    try {
      const { rows } = await pool.query<{ extname: string }>(
        "select extname from pg_extension where extname in ('citext', 'pg_trgm') order by extname",
      );
      expect(rows.map((r) => r.extname)).toEqual(['citext', 'pg_trgm']);
    } finally {
      await pool.end();
    }
  });
});
