import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { assertObjectKey, type ObjectStorage } from './storage';

const TYPES: Record<string, string> = { webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg' };

/**
 * A relative folder is taken from the repository root, so the web app and the demo seed (which
 * run from different package folders) share the same files.
 */
function resolveRoot(dir: string): string {
  if (path.isAbsolute(dir)) return dir;
  let at = process.cwd();
  while (!existsSync(path.join(/*turbopackIgnore: true*/ at, 'pnpm-workspace.yaml'))) {
    const up = path.dirname(at);
    if (up === at) return path.resolve(/*turbopackIgnore: true*/ dir);
    at = up;
  }
  // Development-only storage: keep the bundler from tracing the whole project for this path.
  return path.join(/*turbopackIgnore: true*/ at, dir);
}

/** Files on local disk, for development only (the config refuses it in production). */
export class LocalDiskStorage implements ObjectStorage {
  readonly kind = 'local' as const;
  private readonly root: string;

  constructor(dir: string) {
    this.root = resolveRoot(dir);
  }

  private file(key: string) {
    assertObjectKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, body: Buffer) {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async get(key: string) {
    try {
      const body = await readFile(this.file(key));
      return { body, contentType: TYPES[key.split('.').pop()!] ?? 'application/octet-stream' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async delete(key: string) {
    await rm(this.file(key), { force: true });
  }
}
