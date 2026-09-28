import { pino, stdSerializers, type Logger } from 'pino';

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
  'phoneE164',
  'notes',
  'raw',
  'cancelReason',
  'token',
  'password',
  'authorization',
  'cookie',
  '*.phone',
  '*.phone_e164',
  '*.email',
  '*.full_name',
  '*.fullName',
  '*.phoneE164',
  '*.phoneOriginal',
  '*.notes',
  '*.raw',
  '*.cancelReason',
  '*.token',
  '*.password',
  'req.headers.authorization',
  'req.headers.cookie',
];

const PARAMS_TAIL = /\nparams:[\s\S]*$/;

/**
 * Error serializer that keeps what's needed to debug (type, code, constraint, stack) but drops
 * the parts of database errors that echo data: query parameters and Postgres `detail`
 * ("Failing row contains (...)").
 */
export function serializeError(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const out = stdSerializers.err(err) as unknown as Record<string, unknown>;
  const scrub = (v: unknown) =>
    typeof v === 'string' ? v.replace(PARAMS_TAIL, '\nparams: [redacted]') : v;
  out.message = scrub(out.message);
  out.stack = scrub(out.stack);
  for (const key of ['params', 'detail', 'where', 'query', 'internalQuery', 'hint'])
    delete out[key];
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === 'object') {
    const c = cause as Record<string, unknown>;
    out.cause = {
      type: c.constructor?.name,
      code: c.code,
      constraint: c.constraint,
      table: c.table,
      column: c.column,
    };
  }
  return out;
}

export function createLogger(options: { level?: string; name?: string } = {}): Logger {
  return pino({
    level: options.level ?? 'info',
    ...(options.name ? { name: options.name } : {}),
    redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
    serializers: { err: serializeError },
  });
}
