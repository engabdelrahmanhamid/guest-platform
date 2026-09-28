import { createLogger, loadConfig } from '@gp/core';
import { PgBoss } from 'pg-boss';

// Background worker. Phase 0 only proves the queue runs; jobs (import parsing, lifecycle
// scheduler, outbox dispatcher, retention) are registered here as their modules land.
const config = loadConfig();
const log = createLogger({ level: config.LOG_LEVEL, name: 'worker' });

const boss = new PgBoss(config.DATABASE_URL);
boss.on('error', (err) => log.error({ err }, 'job queue error'));

const HEARTBEAT = 'system.heartbeat';

await boss.start();
await boss.createQueue(HEARTBEAT);
await boss.work(HEARTBEAT, async () => {
  log.info('heartbeat');
});
await boss.schedule(HEARTBEAT, '*/5 * * * *');
log.info('worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'worker stopping');
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
