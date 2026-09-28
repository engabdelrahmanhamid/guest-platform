import { describe, expect, it } from 'vitest';
import { publicToken } from '../shared/tokens';
import { createTestContext, databaseUrl } from '../testing/harness';
import { guardPublicRequest, noteUnknownToken, publicClientKey } from './public-limits';
import { passQrSvg } from './qr';

const code = (c: string) => expect.objectContaining({ code: c });

describe('public request limits', () => {
  it('keys clients by a keyed hash, never the address itself', () => {
    const secret = Buffer.alloc(32, 7);
    const key = publicClientKey('203.0.113.9', secret);
    expect(key).toHaveLength(22);
    expect(key).not.toContain('203');
    expect(publicClientKey('203.0.113.9', secret)).toBe(key);
    expect(publicClientKey('203.0.113.10', secret)).not.toBe(key);
    expect(publicClientKey('203.0.113.9', Buffer.alloc(32, 8))).not.toBe(key);
  });

  it('draws the QR from the opaque payload only', async () => {
    const svg = await passQrSvg('AbCdEfGhIjKlMnOpQrStUv');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).not.toContain('AbCdEfGhIjKlMnOpQrStUv');
  });
});

describe.skipIf(!databaseUrl)('public request limits (database)', () => {
  const ctx = createTestContext(new Date('2035-02-01T09:00:00Z'));

  it('cuts off a client that keeps trying unknown links', async () => {
    const client = `test-${publicToken()}`;
    const token = publicToken();
    // 30 unknown links in 15 minutes are tolerated (typos, old links); the 31st blocks.
    for (let i = 0; i < 31; i++) await noteUnknownToken(ctx.db, client, ctx.now());
    await expect(guardPublicRequest(ctx.db, 'view', client, token, ctx.now())).rejects.toEqual(
      code('rate_limited'),
    );
    // Another client is unaffected.
    await guardPublicRequest(ctx.db, 'view', `other-${publicToken()}`, token, ctx.now());
  });

  it('limits answers per link, whichever client sends them', async () => {
    const token = publicToken();
    for (let i = 0; i < 20; i++) {
      await guardPublicRequest(ctx.db, 'rsvp', `c-${publicToken()}`, token, ctx.now());
    }
    await expect(
      guardPublicRequest(ctx.db, 'rsvp', `c-${publicToken()}`, token, ctx.now()),
    ).rejects.toEqual(code('rate_limited'));
  });
});
