import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS } from './logger';

function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(chunk.toString());
      cb();
    },
  });
  const log = pino({ redact: { paths: REDACTED_PATHS, censor: '[redacted]' } }, stream);
  return { log, lines };
}

describe('logger redaction', () => {
  it('removes guest personal data and tokens', () => {
    const { log, lines } = capture();
    log.info(
      { phone_e164: '+966551234567', guest: { full_name: 'محمد العتيبي', token: 'abc' } },
      'guest created',
    );
    const out = lines.join('');
    expect(out).not.toContain('+966551234567');
    expect(out).not.toContain('محمد');
    expect(out).not.toContain('"abc"');
    expect(out).toContain('[redacted]');
  });
});
