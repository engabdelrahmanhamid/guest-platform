import 'server-only';
import { createLogger, loadConfig, type AppConfig, type Logger } from '@gp/core';
import { createPool } from '@gp/db';
import type pg from 'pg';

// One config, logger and pool per server process, created on first use so that
// `next build` does not need runtime secrets.
let config: AppConfig | undefined;
let logger: Logger | undefined;
let dbPool: pg.Pool | undefined;

export function getConfig(): AppConfig {
  return (config ??= loadConfig());
}

export function getLogger(): Logger {
  return (logger ??= createLogger({ level: getConfig().LOG_LEVEL, name: 'web' }));
}

export function getPool(): pg.Pool {
  return (dbPool ??= createPool(getConfig().DATABASE_URL));
}
