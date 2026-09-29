import { z } from 'zod';

const optional = z
  .string()
  .optional()
  .transform((v) => (v ? v : undefined));

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.url(),
  DATABASE_URL: z.string().startsWith('postgres'),
  /** Base64 of 32 random bytes; encrypts secrets at rest (admin TOTP). `openssl rand -base64 32` */
  APP_ENCRYPTION_KEY: z
    .string()
    .transform((v) => Buffer.from(v, 'base64'))
    .refine((b) => b.length === 32, { message: 'must be base64 of exactly 32 bytes' }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ERROR_TRACKING_DSN: optional,
  /**
   * How many reverse proxies sit in front of the web app and append to `X-Forwarded-For`. The
   * client address is the entry that many places from the right; anything further left is
   * supplied by the client and ignored. Use 0 when the app is reached directly.
   */
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  /**
   * Where event images are kept. `s3` is any S3-compatible bucket in the Saudi region and is
   * required in production; `local` writes to LOCAL_STORAGE_DIR for development.
   */
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('.data/storage'),
  S3_ENDPOINT: z
    .url()
    .optional()
    .or(z.literal('').transform(() => undefined)),
  S3_REGION: optional,
  S3_BUCKET: optional,
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  /** Account email (owners and admins only, never guests). Required in production. */
  SMTP_HOST: optional,
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SMTP_USER: optional,
  SMTP_PASSWORD: optional,
  MAIL_FROM: optional,
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

const configSchema = baseSchema.superRefine((c, ctx) => {
  // /dev/outbox shows account links and cookies lose `secure` outside production. A public
  // address running in development mode would leak both, so refuse to start.
  if (c.NODE_ENV !== 'production' && c.APP_BASE_URL.startsWith('https://')) {
    ctx.addIssue({
      code: 'custom',
      path: ['NODE_ENV'],
      message: 'must be production when APP_BASE_URL is https',
    });
  }
  if (c.NODE_ENV === 'production' && c.STORAGE_DRIVER !== 's3') {
    ctx.addIssue({
      code: 'custom',
      path: ['STORAGE_DRIVER'],
      message: 'must be s3 in production',
    });
  }
  if (c.NODE_ENV === 'production') {
    for (const key of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'MAIL_FROM'] as const) {
      if (!c[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
    }
  }
  if (c.STORAGE_DRIVER === 's3') {
    for (const key of [
      'S3_REGION',
      'S3_BUCKET',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const) {
      if (!c[key])
        ctx.addIssue({ code: 'custom', path: [key], message: 'required when STORAGE_DRIVER=s3' });
    }
  }
});

export type AppConfig = z.infer<typeof configSchema>;

/** Parses and validates process configuration. Throws with every problem listed. */
export function loadConfig(env: Record<string, string | undefined> = process.env): AppConfig {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid configuration:\n  ${problems.join('\n  ')}`);
  }
  return result.data;
}
