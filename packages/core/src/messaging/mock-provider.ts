import type { MessagingProvider, OutboundMessage, SendResult } from './provider';

/**
 * Delivers nothing. It records what it was asked to send so tests and rehearsals can inspect
 * it, is idempotent per key like a real provider must be, and can be told to fail so callers'
 * failure handling can be exercised.
 */
export class MockMessagingProvider implements MessagingProvider {
  readonly name = 'mock';
  readonly sent: OutboundMessage[] = [];
  /** Recipients that fail with `rejected` (for rehearsing failures). */
  readonly failFor = new Set<string>();
  /** When true every send fails as `unavailable`, retryable (a provider outage). */
  down = false;
  private readonly results = new Map<string, SendResult>();

  async send(message: OutboundMessage): Promise<SendResult> {
    const prior = this.results.get(message.idempotencyKey);
    if (prior) return prior;
    let result: SendResult;
    if (this.down) result = { status: 'failed', code: 'unavailable', retryable: true };
    else if (this.failFor.has(message.to))
      result = { status: 'failed', code: 'rejected', retryable: false };
    else {
      this.sent.push(message);
      result = { status: 'sent', providerMessageId: `mock-${this.sent.length}` };
    }
    // An outage is not remembered: the retry with the same key must be allowed to succeed.
    if (!(result.status === 'failed' && result.retryable))
      this.results.set(message.idempotencyKey, result);
    return result;
  }
}
