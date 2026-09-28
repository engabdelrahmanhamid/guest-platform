import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const valid = {
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(valid);
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.ERROR_TRACKING_DSN).toBeUndefined();
    expect(config.APP_ENCRYPTION_KEY).toHaveLength(32);
  });

  it('rejects an encryption key of the wrong length', () => {
    expect(() => loadConfig({ ...valid, APP_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(
      /APP_ENCRYPTION_KEY/,
    );
  });

  it('lists every invalid value', () => {
    expect(() => loadConfig({ APP_BASE_URL: 'not a url' })).toThrow(
      /APP_BASE_URL[\s\S]*DATABASE_URL/,
    );
  });
});
