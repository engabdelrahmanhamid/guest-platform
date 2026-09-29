import type { Logger } from '../logging/logger';
import { DomainError } from '../shared/errors';
import { parsePhone } from '../shared/phone';
import {
  MESSAGE_CHANNELS,
  type MessagingProvider,
  type OutboundMessage,
  type SendResult,
} from './provider';

const MAX_BODY = 4096;

/**
 * The only way the platform sends a message. It checks what a provider must never be trusted
 * with (channel, recipient, size), then hands over to the configured provider. It logs the
 * outcome without the recipient or the text, which carry personal data and the guest's link.
 */
export class MessagingService {
  constructor(
    private readonly provider: MessagingProvider,
    private readonly log: Logger,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  async send(input: {
    channel: string;
    phone: string;
    body: string;
    idempotencyKey: string;
  }): Promise<SendResult> {
    // Runtime guard as well as the type: input reaches here from forms and jobs.
    if (!MESSAGE_CHANNELS.includes(input.channel as never))
      throw new DomainError('validation_failed', undefined, { field: 'channel' });
    const parsed = parsePhone(input.phone);
    if (!parsed.ok) throw new DomainError('validation_failed', undefined, { field: 'phone' });
    const body = input.body.trim();
    if (!body || body.length > MAX_BODY)
      throw new DomainError('validation_failed', undefined, { field: 'body' });
    if (!input.idempotencyKey) throw new DomainError('validation_failed');

    const message: OutboundMessage = {
      channel: 'whatsapp',
      to: parsed.e164,
      body,
      idempotencyKey: input.idempotencyKey,
    };
    let result: SendResult;
    try {
      result = await this.provider.send(message);
    } catch {
      // A provider that throws is treated as a retryable outage, never as a delivery.
      result = { status: 'failed', code: 'unavailable', retryable: true };
    }
    this.log.info(
      {
        provider: this.provider.name,
        channel: message.channel,
        status: result.status,
        ...(result.status === 'failed' ? { code: result.code, retryable: result.retryable } : {}),
      },
      'message handed to provider',
    );
    return result;
  }
}
