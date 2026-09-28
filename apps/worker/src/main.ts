import { createServer } from 'node:http';
import { createLogger, loadConfig, runLifecycleTick } from '@gp/core';
import { createDatabase, createPool, pingDatabase } from '@gp/db';
import { PgBoss } from 'pg-boss';

// Background worker. Jobs still to come (import parsing, outbox dispatcher, retention) are
// registered here as their modules land.
const config = loadConfig();
const log = createLogger({ level: config.LOG_LEVEL, name: 'worker' });
const pool = createPool(config.DATABASE_URL, 5);
const db = createDatabase(pool);

const boss = new PgBoss(config.DATABASE_URL);
boss.on('error', (err) => log.error({ err }, 'job queue error'));

const HEARTBEAT = 'system.heartbeat';
const LIFECYCLE_TICK = 'events.lifecycle-tick';

await boss.start();
await boss.createQueue(HEARTBEAT);
await boss.work(HEARTBEAT, async () => {
  log.info('heartbeat');
});
await boss.schedule(HEARTBEAT, '*/5 * * * *');

// Opens and closes check-in and auto-archives events. pg-boss schedules one job per minute
// across all worker instances, and the tick itself is idempotent, so retries and overlaps are
// harmless.
await boss.createQueue(LIFECYCLE_TICK);
await boss.work(LIFECYCLE_TICK, async () => {
  const result = await runLifecycleTick(db, new Date());
  if (result.started || result.completed || result.archived) log.info(result, 'lifecycle tick');
});
await boss.schedule(LIFECYCLE_TICK, '* * * * *');

// Health endpoint for the container orchestrator: up only while the database answers.
const healthPort = Number(process.env.WORKER_HEALTH_PORT ?? 8081);
const health = createServer((req, res) => {
  if (req.url !== '/health') {
    res.writeHead(404).end();
    return;
  }
  pingDatabase(pool).then(
    () => res.writeHead(200, { 'content-type': 'application/json' }).end('{"status":"ok"}'),
    (err: unknown) => {
      log.error({ err }, 'health check failed');
      res.writeHead(503, { 'content-type': 'application/json' }).end('{"status":"unavailable"}');
    },
  );
});
health.listen(healthPort);
log.info({ healthPort }, 'worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'worker stopping');
  health.close();
  await boss.stop({ graceful: true, timeout: 30_000 });
  await pool.end();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
