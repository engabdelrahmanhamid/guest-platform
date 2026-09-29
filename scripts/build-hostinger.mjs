#!/usr/bin/env node
// Builds the web app and assembles a self-contained folder that a host can run with one command,
// without the repository's node_modules or Next.js's own launcher:
//
//   pnpm run build:hostinger      ->  dist/hostinger/
//   node dist/hostinger/server.js
//
// dist/hostinger holds Next.js's standalone output (the server, plus the dependencies it traced,
// with the workspace packages @gp/core and @gp/db compiled into the server bundle), the static
// assets it does not include by itself, and a small launcher that honours the host's PORT and always
// binds to all interfaces. Nothing in it points back to the repository.
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'apps/web');
const out = join(root, 'dist/hostinger');

// A NODE_ENV of "development" (as in a local .env) breaks the production build.
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: '1' };
delete env.NODE_ENV;
const build = spawnSync('pnpm', ['--filter', '@gp/web', 'build'], {
  cwd: root,
  env,
  stdio: 'inherit',
});
if (build.status !== 0) process.exit(build.status ?? 1);

const standalone = join(web, '.next/standalone');
if (!existsSync(join(standalone, 'apps/web/server.js'))) {
  throw new Error(
    'standalone output not found: is `output: "standalone"` set in apps/web/next.config.ts?',
  );
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// The traced dependencies use pnpm's layout: each package is a symlink to a folder whose sibling
// folders are its own dependencies. The links are relative, so `cp -a` keeps them working inside
// the copy. Do not dereference them: a package copied out of its pnpm folder can no longer find its
// dependencies (next would lose @swc/helpers). If a host's upload drops symlinks, build on the host.
const copy = spawnSync('cp', ['-a', `${standalone}/.`, out], { stdio: 'inherit' });
if (copy.status !== 0) throw new Error('could not copy the standalone output');
// Next.js standalone leaves these out: the app's static files and the public folder.
cpSync(join(web, '.next/static'), join(out, 'apps/web/.next/static'), { recursive: true });
if (existsSync(join(web, 'public')))
  cpSync(join(web, 'public'), join(out, 'apps/web/public'), { recursive: true });

writeFileSync(join(out, 'package.json'), '{ "private": true, "type": "commonjs" }\n');
writeFileSync(
  join(out, 'server.js'),
  `// Launcher for hosts that set PORT and HOSTNAME themselves. HOSTNAME is often the machine's own
// name, which would make the server unreachable from the host's proxy, so it is always overridden.
process.env.HOSTNAME = '0.0.0.0';
process.env.PORT = process.env.PORT || '3000';
process.env.NODE_ENV = 'production';
import('./apps/web/server.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
`,
);
process.stdout.write(`\nReady: ${out}\nRun:   node dist/hostinger/server.js\n`);
