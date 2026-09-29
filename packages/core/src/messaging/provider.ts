/**
 * The port between the platform and whatever delivers a guest message. V1 ships only the mock
 * adapter (development, tests, rehearsals); real delivery stays manual through the owner's
 * "Share via WhatsApp" button. A future WhatsApp API adapter implements this same interface and
 * lives outside `packages/core`.
 *
 * There is deliberately no SMS or email channel: the channel type below can't express one.
 */
export type MessageChannel = 'whatsapp';

export const MESSAGE_CHANNELS: readonly MessageChannel[] = ['whatsapp'];

export interface OutboundMessage {
  channel: MessageChannel;
  /** Recipient phone in E.164 form, for example `+966501234567`. */
  to: string;
  /** Ready-to-send text. It contains the guest's link, so it is never logged. */
  body: string;
  /** Sending the same key twice must deliver once and return the first result. */
  idempotencyKey: string;
}

export type SendResult =
  | { status: 'sent'; providerMessageId: string }
  | {
      status: 'failed';
      code: 'invalid_recipient' | 'rejected' | 'unavailable';
      retryable: boolean;
    };

export interface MessagingProvider {
  /** Short adapter name for logs and reports, such as `mock`. */
  readonly name: string;
  send(message: OutboundMessage): Promise<SendResult>;
}
