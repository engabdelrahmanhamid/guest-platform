import 'server-only';
import {
  type AccountMailer,
  type AppConfig,
  type CoreContext,
  createLogger,
  loadConfig,
  LocalDiskStorage,
  type Logger,
  MemoryMailer,
  type ObjectStorage,
  S3Storage,
} from '@gp/core';
import { createDatabase, createPool, type Database } from '@gp/db';
import type pg from 'pg';

// One config, logger, pool and context per server process, created on first use so that
// `next build` does not need runtime secrets.
let config: AppConfig | undefined;
let logger: Logger | undefined;
let dbPool: pg.Pool | undefined;
let db: Database | undefined;
let ctx: CoreContext | undefined;

export function getConfig(): AppConfig {
  return (config ??= loadConfig());
}

export function getLogger(): Logger {
  return (logger ??= createLogger({ level: getConfig().LOG_LEVEL, name: 'web' }));
}

export function getPool(): pg.Pool {
  return (dbPool ??= createPool(getConfig().DATABASE_URL));
}

/**
 * Development keeps account emails in memory and shows them at /dev/outbox, so links (which
 * carry tokens) are never written to logs. Production needs a mail provider chosen with the
 * hosting provider; until then emails are dropped with a warning that names no token.
 */
const devOutbox = new MemoryMailer();

class UnconfiguredMailer implements AccountMailer {
  async sendEmailVerification() {
    getLogger().warn({ kind: 'email_verification' }, 'account email provider not configured');
  }
  async sendPasswordReset() {
    getLogger().warn({ kind: 'password_reset' }, 'account email provider not configured');
  }
}

export function getDevOutbox(): MemoryMailer | null {
  return getConfig().NODE_ENV === 'production' ? null : devOutbox;
}

/** Event images: the Saudi-region bucket in production, a local folder in development. */
function createStorage(cfg: AppConfig): ObjectStorage {
  if (cfg.STORAGE_DRIVER === 's3') {
    return new S3Storage({
      endpoint: cfg.S3_ENDPOINT,
      region: cfg.S3_REGION!,
      bucket: cfg.S3_BUCKET!,
      accessKeyId: cfg.S3_ACCESS_KEY_ID!,
      secretAccessKey: cfg.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: cfg.S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalDiskStorage(cfg.LOCAL_STORAGE_DIR);
}

export function getCoreContext(): CoreContext {
  if (!ctx) {
    const cfg = getConfig();
    db = createDatabase(getPool());
    ctx = {
      db,
      mailer: cfg.NODE_ENV === 'production' ? new UnconfiguredMailer() : devOutbox,
      storage: createStorage(cfg),
      encryptionKey: cfg.APP_ENCRYPTION_KEY,
      appBaseUrl: cfg.APP_BASE_URL,
      now: () => new Date(),
    };
  }
  return ctx;
}
