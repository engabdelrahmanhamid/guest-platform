import { describe, expect, it } from 'vitest';
import { createLogger } from '../logging/logger';
import { MessagingService } from './service';
import { MockMessagingProvider } from './mock-provider';
import type { MessagingProvider } from './provider';

const code = (c: string) => expect.objectContaining({ code: c });

function setup(provider: MessagingProvider = new MockMessagingProvider()) {
  const lines: string[] = [];
  const log = createLogger({
    level: 'info',
    destination: { write: (l: string) => void lines.push(l) },
  });
  return { service: new MessagingService(provider, log), lines, provider };
}
const msg = (over: Record<string, string> = {}) => ({
  channel: 'whatsapp',
  phone: '0501234567',
  body: 'دعوتك: http://localhost:3000/i/abcdefghijABCDEFGHIJ12',
  idempotencyKey: 'k1',
  ...over,
});

describe('messaging service', () => {
  it('hands a normalized message to the provider, once per key', async () => {
    const { service, provider } = setup();
    const a = await service.send(msg());
    const b = await service.send(msg());
    expect(a).toEqual({ status: 'sent', providerMessageId: 'mock-1' });
    expect(b).toEqual(a);
    expect((provider as MockMessagingProvider).sent).toEqual([
      expect.objectContaining({ to: '+966501234567', channel: 'whatsapp' }),
    ]);
  });

  it('has no SMS or email channel, and rejects bad recipients and bodies', async () => {
    const { service } = setup();
    await expect(service.send(msg({ channel: 'sms' }))).rejects.toEqual(code('validation_failed'));
    await expect(service.send(msg({ channel: 'email' }))).rejects.toEqual(
      code('validation_failed'),
    );
    await expect(service.send(msg({ phone: '123' }))).rejects.toEqual(code('validation_failed'));
    await expect(service.send(msg({ body: '   ' }))).rejects.toEqual(code('validation_failed'));
    await expect(service.send(msg({ body: 'x'.repeat(4097) }))).rejects.toEqual(
      code('validation_failed'),
    );
  });

  it('reports failures, retries an outage with the same key, and never logs the text or number', async () => {
    const mock = new MockMessagingProvider();
    const { service, lines } = setup(mock);
    mock.down = true;
    expect(await service.send(msg())).toEqual({
      status: 'failed',
      code: 'unavailable',
      retryable: true,
    });
    mock.down = false;
    expect(await service.send(msg())).toMatchObject({ status: 'sent' });
    mock.failFor.add('+966501234567');
    expect(await service.send(msg({ idempotencyKey: 'k2' }))).toEqual({
      status: 'failed',
      code: 'rejected',
      retryable: false,
    });
    const logged = lines.join('\n');
    expect(logged).toContain('message handed to provider');
    expect(logged).not.toContain('966501234567');
    expect(logged).not.toContain('0501234567');
    expect(logged).not.toContain('abcdefghijABCDEFGHIJ12');
  });

  it('treats a provider that throws as a retryable outage', async () => {
    const { service } = setup({
      name: 'broken',
      send: async () => {
        throw new Error('socket closed for +966501234567');
      },
    });
    expect(await service.send(msg())).toEqual({
      status: 'failed',
      code: 'unavailable',
      retryable: true,
    });
  });
});
