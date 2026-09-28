/**
 * Account email (verification, password reset) to owners and admins only. It is never used
 * for guests. The production adapter is chosen with the hosting provider; development prints
 * links to the server console.
 */
export interface AccountMailer {
  sendEmailVerification(to: { email: string; name: string }, link: string): Promise<void>;
  sendPasswordReset(to: { email: string; name: string }, link: string): Promise<void>;
}

export interface SentMail {
  kind: 'email_verification' | 'password_reset';
  to: string;
  link: string;
}

/** Collects mail in memory. Used by tests. */
export class MemoryMailer implements AccountMailer {
  readonly sent: SentMail[] = [];
  async sendEmailVerification(to: { email: string }, link: string) {
    this.sent.push({ kind: 'email_verification', to: to.email, link });
  }
  async sendPasswordReset(to: { email: string }, link: string) {
    this.sent.push({ kind: 'password_reset', to: to.email, link });
  }
  lastLink(kind: SentMail['kind'], email: string): string | undefined {
    return this.sent.filter((m) => m.kind === kind && m.to === email).at(-1)?.link;
  }
}
