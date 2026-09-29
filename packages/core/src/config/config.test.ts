import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const valid = {
  APP_BASE_URL: 'http://localhost:3000',
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  APP_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
};

const smtp = {
  SMTP_HOST: 'smtp.example.sa',
  SMTP_USER: 'user',
  SMTP_PASSWORD: 'pw',
  MAIL_FROM: 'Guest Platform <no-reply@example.sa>',
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

  it('stores images on local disk in development and needs a bucket in production', () => {
    expect(loadConfig(valid).STORAGE_DRIVER).toBe('local');
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production' })).toThrow(/STORAGE_DRIVER/);
    expect(() => loadConfig({ ...valid, NODE_ENV: 'production', STORAGE_DRIVER: 's3' })).toThrow(
      /S3_BUCKET/,
    );
    const s3 = loadConfig({
      ...valid,
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_ENDPOINT: 'https://storage.example.sa',
      S3_REGION: 'riyadh-1',
      S3_BUCKET: 'guest-media',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
      ...smtp,
    });
    expect(s3.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it('refuses development mode on a public https address', () => {
    expect(() => loadConfig({ ...valid, APP_BASE_URL: 'https://app.example.sa' })).toThrow(
      /NODE_ENV/,
    );
    expect(loadConfig(valid).TRUSTED_PROXY_HOPS).toBe(1);
  });

  it('needs a mail provider in production, not in development', () => {
    expect(loadConfig(valid).SMTP_HOST).toBeUndefined();
    const prod = {
      ...valid,
      APP_BASE_URL: 'https://app.example.sa',
      NODE_ENV: 'production',
      STORAGE_DRIVER: 's3',
      S3_REGION: 'riyadh-1',
      S3_BUCKET: 'guest-media',
      S3_ACCESS_KEY_ID: 'id',
      S3_SECRET_ACCESS_KEY: 'secret',
    };
    expect(() => loadConfig(prod)).toThrow(/SMTP_HOST/);
    const cfg = loadConfig({ ...prod, ...smtp });
    expect(cfg).toMatchObject({ SMTP_PORT: 465, SMTP_SECURE: true });
  });
});
