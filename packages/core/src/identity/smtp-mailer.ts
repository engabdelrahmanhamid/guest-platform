import { createTransport, type Transporter } from 'nodemailer';
import type { Logger } from '../logging/logger';
import type { AccountMailer } from './mailer';

export interface SmtpMailerConfig {
  host: string;
  port: number;
  /** Implicit TLS (port 465). Otherwise the connection upgrades with STARTTLS and must succeed. */
  secure: boolean;
  user: string;
  password: string;
  /** For example `Guest Platform <no-reply@example.sa>`. */
  from: string;
}

/**
 * Account email (verification, password reset) for owners and admins over SMTP, so any
 * provider hosted in the Saudi region can be used without changing code. It is never used for
 * guests. TLS is required and certificates are verified.
 *
 * A failed send is logged (kind only, never the address or link) and swallowed: a password
 * reset must not reveal whether an account exists, and the verification email can be re-sent.
 */
export class SmtpMailer implements AccountMailer {
  private readonly transport: Transporter;

  constructor(
    private readonly config: SmtpMailerConfig,
    private readonly log: Logger,
    transport?: Transporter,
  ) {
    this.transport =
      transport ??
      createTransport({
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: !config.secure,
        auth: { user: config.user, pass: config.password },
        tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
        connectionTimeout: 10_000,
        socketTimeout: 20_000,
      });
  }

  /** Confirms the provider accepts our credentials. Used by the pilot readiness check. */
  async verify(): Promise<void> {
    await this.transport.verify();
  }

  sendEmailVerification(to: { email: string; name: string }, link: string): Promise<void> {
    return this.deliver('email_verification', to.email, 'تأكيد بريدك الإلكتروني', [
      `مرحبًا ${to.name}،`,
      'اضغط على الرابط التالي لتأكيد بريدك الإلكتروني وتفعيل مناسباتك:',
      link,
      'إن لم تُنشئ حسابًا في المنصة فتجاهل هذه الرسالة.',
    ]);
  }

  sendPasswordReset(to: { email: string; name: string }, link: string): Promise<void> {
    return this.deliver('password_reset', to.email, 'إعادة تعيين كلمة المرور', [
      `مرحبًا ${to.name}،`,
      'وصلنا طلب لإعادة تعيين كلمة المرور. اضغط على الرابط التالي لاختيار كلمة جديدة (صالح لمدة محدودة):',
      link,
      'إن لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة مرورك لم تتغير.',
    ]);
  }

  private async deliver(kind: string, to: string, subject: string, lines: string[]) {
    try {
      await this.transport.sendMail({
        from: this.config.from,
        to,
        subject,
        text: lines.join('\n\n'),
      });
      this.log.info({ kind }, 'account email sent');
    } catch (err) {
      // No address, no link, and no provider message (it can echo the recipient).
      this.log.error(
        { kind, code: (err as { code?: string }).code ?? 'unknown' },
        'account email failed',
      );
    }
  }
}
