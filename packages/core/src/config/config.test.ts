import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const valid = {
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
};

describe('loadConfig', () => {
  it('applies defaults', () => {
    const config = loadConfig(valid);
    expect(config.NODE_ENV).toBe('development');
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.ERROR_TRACKING_DSN).toBeUndefined();
  });

  it('lists every invalid value', () => {
    expect(() => loadConfig({ APP_BASE_URL: 'not a url' })).toThrow(
      /APP_BASE_URL[\s\S]*DATABASE_URL/,
    );
  });
});
