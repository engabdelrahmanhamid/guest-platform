import type { Transporter } from 'nodemailer';
import { describe, expect, it } from 'vitest';
import { createLogger } from '../logging/logger';
import { SmtpMailer } from './smtp-mailer';

const config = {
  host: 'smtp.example.sa',
  port: 465,
  secure: true,
  user: 'u',
  password: 'pw',
  from: 'Guest Platform <no-reply@example.sa>',
};

function setup(fail?: Error) {
  const sent: Record<string, string>[] = [];
  const lines: string[] = [];
  const transport = {
    sendMail: async (m: Record<string, string>) => {
      if (fail) throw fail;
      sent.push(m);
    },
  } as unknown as Transporter;
  const log = createLogger({ destination: { write: (l) => void lines.push(l) } });
  return { mailer: new SmtpMailer(config, log, transport), sent, lines };
}

describe('SmtpMailer', () => {
  it('sends verification and reset mail with the link in the body', async () => {
    const { mailer, sent } = setup();
    await mailer.sendEmailVerification(
      { email: 'a@b.sa', name: 'نورة' },
      'https://app.example.sa/verify-email?token=T1',
    );
    await mailer.sendPasswordReset(
      { email: 'a@b.sa', name: 'نورة' },
      'https://app.example.sa/reset?token=T2',
    );
    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ from: config.from, to: 'a@b.sa' });
    expect(sent[0]!.text).toContain('token=T1');
    expect(sent[1]!.text).toContain('token=T2');
  });

  it('swallows a provider failure and logs neither address, link nor provider text', async () => {
    const err = Object.assign(new Error('550 mailbox a@b.sa rejected'), { code: 'EENVELOPE' });
    const { mailer, lines } = setup(err);
    await expect(
      mailer.sendPasswordReset(
        { email: 'a@b.sa', name: 'نورة' },
        'https://app.example.sa/reset?token=SECRET',
      ),
    ).resolves.toBeUndefined();
    const logged = lines.join('\n');
    expect(logged).toContain('account email failed');
    expect(logged).toContain('EENVELOPE');
    expect(logged).not.toContain('a@b.sa');
    expect(logged).not.toContain('SECRET');
  });
});
