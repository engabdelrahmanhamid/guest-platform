import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.url(),
  DATABASE_URL: z.string().startsWith('postgres'),
  /** Base64 of 32 random bytes; encrypts secrets at rest (admin TOTP). `openssl rand -base64 32` */
  APP_ENCRYPTION_KEY: z
    .string()
    .transform((v) => Buffer.from(v, 'base64'))
    .refine((b) => b.length === 32, { message: 'must be base64 of exactly 32 bytes' }),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  ERROR_TRACKING_DSN: z
    .string()
    .optional()
    .transform((v) => (v ? v : undefined)),
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
