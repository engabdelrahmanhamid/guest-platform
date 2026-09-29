import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS, serializeError } from './logger';

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

  it('also covers staff details, secrets and values two levels down', () => {
    const { log, lines } = capture();
    log.info(
      {
        session: { deviceLabel: 'iPhone · Safari', ip: '203.0.113.9' },
        member: { displayName: 'خالد الشهري', staffPhone: '+966550000201' },
        cfg: { smtpPassword: 'hunter2', totpSecret: 'JBSWY3DP' },
        ctx: {
          request: { phone: '+966551234567', sessionToken: 'S3CR3T', url: 'https://x/s/T0K' },
        },
        req: { headers: { 'x-forwarded-for': '198.51.100.7', 'set-cookie': 'gp_staff=ABC' } },
      },
      'ops',
    );
    const out = lines.join('');
    for (const secret of [
      'iPhone',
      '203.0.113.9',
      'خالد',
      '550000201',
      'hunter2',
      'JBSWY3DP',
      '551234567',
      'S3CR3T',
      'T0K',
      '198.51.100.7',
      'gp_staff=ABC',
    ])
      expect(out).not.toContain(secret);
  });
});

describe('error serializer', () => {
  it('drops query parameters and row details from database errors', () => {
    const cause = Object.assign(new Error('null value violates not-null constraint'), {
      code: '23502',
      constraint: 'x',
      detail: 'Failing row contains (محمد, +966551234567).',
    });
    const err = new Error(
      'Failed query: insert into guests values ($1, $2)\nparams: محمد,+966551234567',
      { cause },
    );
    const out = JSON.stringify(serializeError(err));
    expect(out).not.toContain('محمد');
    expect(out).not.toContain('+966551234567');
    expect(out).toContain('23502');
    expect(out).toContain('Failed query: insert into guests');
  });
});
