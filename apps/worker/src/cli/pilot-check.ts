import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createLogger,
  decrypt,
  encrypt,
  LocalDiskStorage,
  loadConfig,
  randomToken,
  S3Storage,
  SmtpMailer,
  type ObjectStorage,
} from '@gp/core';
import { createPool, pingDatabase } from '@gp/db';

// Pilot readiness check, run against a deployed environment (staging first, then production):
//   pnpm pilot:check [--url=https://app.example.sa] [--mail-to=you@example.sa]
// It reads the same environment as the app. It prints one line per check and exits 1 if any
// check failed. It never prints secrets, tokens or guest data. Warnings need a human decision.
// --mail-to sends one real account-style email to that address (an owner or operator mailbox,
// never a guest) to prove delivery end to end.
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k!, v.join('=')] as const;
  }),
);

type Level = 'pass' | 'warn' | 'fail';
const results: { level: Level; name: string; detail?: string }[] = [];
async function check(name: string, fn: () => Promise<{ level?: Level; detail?: string } | void>) {
  try {
    const r = (await fn()) ?? {};
    results.push({ level: r.level ?? 'pass', name, detail: r.detail });
  } catch (err) {
    results.push({ level: 'fail', name, detail: err instanceof Error ? err.message : 'failed' });
  }
}

const config = loadConfig();
const baseUrl = (args.get('url') || config.APP_BASE_URL).replace(/\/$/, '');

await check('configuration is valid for production', async () => {
  if (config.NODE_ENV !== 'production')
    return { level: 'warn', detail: `NODE_ENV is ${config.NODE_ENV}, not production` };
  if (!baseUrl.startsWith('https://')) throw new Error('APP_BASE_URL must be https');
});

const pool = createPool(config.DATABASE_URL, 2);
await check('database answers', () => pingDatabase(pool));

await check('all migrations are applied', async () => {
  const journal = JSON.parse(
    readFileSync(
      fileURLToPath(
        new URL('../../../../packages/db/migrations/meta/_journal.json', import.meta.url),
      ),
      'utf8',
    ),
  ) as { entries: unknown[] };
  const { rows } = await pool.query('select count(*)::int as n from drizzle.__drizzle_migrations');
  const applied = Number(rows[0]?.n ?? 0);
  if (applied !== journal.entries.length)
    throw new Error(`${applied} applied, ${journal.entries.length} expected`);
  return { detail: `${applied} migrations` };
});

await check('stored tokens are encrypted with this key', async () => {
  const round = decrypt(
    encrypt('probe', config.APP_ENCRYPTION_KEY, 'aad'),
    config.APP_ENCRYPTION_KEY,
    'aad',
  );
  if (round !== 'probe') throw new Error('encryption round trip failed');
  // A row sealed with a different key would fail here: this is the "wrong key" check.
  const { rows } = await pool.query(
    `select id, token_enc from invitations order by created_at desc limit 1`,
  );
  if (rows[0]) {
    try {
      decrypt(
        rows[0].token_enc as Buffer,
        config.APP_ENCRYPTION_KEY,
        `gp.public-token:invitation:${rows[0].id}`,
      );
    } catch {
      throw new Error('the newest invitation cannot be opened with APP_ENCRYPTION_KEY');
    }
  }
});

await check('object storage stores, reads and deletes', async () => {
  const storage: ObjectStorage =
    config.STORAGE_DRIVER === 's3'
      ? new S3Storage({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION!,
          bucket: config.S3_BUCKET!,
          accessKeyId: config.S3_ACCESS_KEY_ID!,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        })
      : new LocalDiskStorage(config.LOCAL_STORAGE_DIR);
  const key = `event-media/${randomToken(16)
    .replace(/[^0-9A-Za-z]/g, 'a')
    .slice(0, 22)
    .padEnd(22, 'a')}.png`;
  await storage.put(key, Buffer.from('pilot-check'), 'image/png');
  const got = await storage.get(key);
  await storage.delete(key);
  if (got?.body.toString() !== 'pilot-check') throw new Error('read back did not match');
  if (await storage.get(key)) throw new Error('object still present after delete');
  return { detail: storage.kind };
});

await check('account email provider accepts our credentials', async () => {
  if (!config.SMTP_HOST) return { level: 'warn', detail: 'SMTP is not configured' };
  const log = createLogger({ name: 'pilot-check' });
  const mailer = new SmtpMailer(
    {
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_SECURE,
      user: config.SMTP_USER!,
      password: config.SMTP_PASSWORD!,
      from: config.MAIL_FROM!,
    },
    log,
  );
  await mailer.verify();
  const to = args.get('mail-to');
  if (to) {
    await mailer.sendPasswordReset(
      { email: to, name: 'فحص الجاهزية' },
      `${baseUrl}/reset-password?token=pilot-check`,
    );
    return { detail: 'verified; a test message was sent, confirm it arrived' };
  }
  return {
    level: 'warn',
    detail: 'credentials verified; run with --mail-to=<owner mailbox> to prove delivery',
  };
});

await check('log redaction hides personal data and tokens', async () => {
  const lines: string[] = [];
  const log = createLogger({ destination: { write: (l) => void lines.push(l) } });
  log.info(
    {
      phone: '+966551234567',
      guest: { fullName: 'اسم', token: 'TOKEN123' },
      url: 'https://x/s/TOK',
    },
    'x',
  );
  const out = lines.join('');
  for (const s of ['966551234567', 'اسم', 'TOKEN123', 'TOK"'])
    if (out.includes(s)) throw new Error('leaked');
});

// What a browser sees at the deployed address.
const get = (path: string, init: RequestInit = {}) =>
  fetch(baseUrl + path, { redirect: 'manual', ...init });
await check('health endpoint answers over HTTPS', async () => {
  const r = await get('/api/health');
  if (r.status !== 200) throw new Error(`status ${r.status}`);
});
await check('plain HTTP redirects to HTTPS', async () => {
  if (!baseUrl.startsWith('https://')) return { level: 'warn', detail: 'not an https address' };
  const r = await fetch(baseUrl.replace('https://', 'http://') + '/', { redirect: 'manual' }).catch(
    () => null,
  );
  if (!r)
    return { level: 'warn', detail: 'port 80 is closed (acceptable if HSTS preload is planned)' };
  if (
    ![301, 302, 307, 308].includes(r.status) ||
    !String(r.headers.get('location')).startsWith('https://')
  )
    throw new Error(`status ${r.status}, no redirect to https`);
});
await check('pages carry the security headers', async () => {
  const home = await get('/login');
  const need: [string, RegExp][] = [
    ['strict-transport-security', /max-age=\d{7,}/],
    ['x-content-type-options', /nosniff/],
    ['x-frame-options', /DENY/],
    ['permissions-policy', /camera=\(self\)/],
  ];
  const missing = need.filter(([h, re]) => !re.test(home.headers.get(h) ?? '')).map(([h]) => h);
  if (missing.length) throw new Error(`missing: ${missing.join(', ')}`);
});
await check('guest and door pages are private and send only the origin as referrer', async () => {
  for (const path of ['/i/aaaaaaaaaaaaaaaaaaaaaa', '/s/aaaaaaaaaaaaaaaaaaaaaa', '/scan']) {
    const r = await get(path);
    const h = (n: string) => r.headers.get(n) ?? '';
    if (
      !/no-store/.test(h('cache-control')) ||
      h('referrer-policy') !== 'origin' ||
      !/noindex/.test(h('x-robots-tag'))
    )
      throw new Error(`${path} headers`);
  }
});
await check('client addresses come from the trusted proxy hop', async () => {
  if (config.TRUSTED_PROXY_HOPS === 0)
    return { level: 'warn', detail: 'TRUSTED_PROXY_HOPS is 0: no per-address limits' };
  return {
    level: 'warn',
    detail: `TRUSTED_PROXY_HOPS=${config.TRUSTED_PROXY_HOPS}; confirm your proxy appends to X-Forwarded-For`,
  };
});

await pool.end();
const mark = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' } as const;
for (const r of results)
  process.stdout.write(`${mark[r.level]}  ${r.name}${r.detail ? ` (${r.detail})` : ''}\n`);
const failed = results.filter((r) => r.level === 'fail').length;
const warned = results.filter((r) => r.level === 'warn').length;
process.stdout.write(
  `\n${results.length - failed - warned} passed, ${warned} to review, ${failed} failed\n`,
);
process.exitCode = failed ? 1 : 0;
