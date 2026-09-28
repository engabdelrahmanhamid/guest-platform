import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Fields that may carry guest personal data or secrets. They are replaced before a log line
 * leaves the process, so logs and external error tracking never receive them.
 */
export const REDACTED_PATHS = [
  'phone',
  'phone_e164',
  'phoneOriginal',
  'phone_original',
  'email',
  'full_name',
  'fullName',
  'token',
  'password',
  'authorization',
  'cookie',
  '*.phone',
  '*.phone_e164',
  '*.email',
  '*.full_name',
  '*.fullName',
  '*.token',
  '*.password',
  'req.headers.authorization',
  'req.headers.cookie',
];

export function createLogger(options: { level?: string; name?: string } = {}): Logger {
  return pino({
    level: options.level ?? 'info',
    ...(options.name ? { name: options.name } : {}),
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
  });
}
