import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvent, transitionEvent } from '../events/events';
import { readEventImage, removeEventImage, uploadEventImage } from '../lifecycle/design';
import { createOwner, createTestContext, databaseUrl, eventInput } from '../testing/harness';
import { processImage } from './images';
import { S3Storage } from './s3';

const code = (c: string) => expect.objectContaining({ code: c });

async function png(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: '#0e5a4b' } })
    .png()
    .toBuffer();
}

describe('event images', () => {
  it('re-encodes JPEG, PNG and WebP as WebP, scaled down, without metadata', async () => {
    const jpeg = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#884400' },
    })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'camera-owner', Artist: 'someone' } } })
      .toBuffer();
    const out = await processImage('cover', jpeg);
    expect(out).toMatchObject({ contentType: 'image/webp', width: 1600, height: 1067 });
    const meta = await sharp(out.body).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect((await processImage('logo', await png(800, 800))).width).toBe(512);
  });

  it('turns photos upright using their orientation tag', async () => {
    const sideways = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#335577' },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const out = await processImage('cover', sideways);
    expect([out.width, out.height]).toEqual([800, 1200]);
  });

  it('refuses files that are not images, animations, SVG, tiny or oversized images', async () => {
    await expect(processImage('cover', Buffer.from('not an image'))).rejects.toEqual(
      code('image_unsupported'),
    );
    await expect(
      processImage('cover', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')),
    ).rejects.toEqual(code('image_unsupported'));
    const gif = await sharp({
      create: { width: 800, height: 600, channels: 3, background: '#000' },
    })
      .gif()
      .toBuffer();
    await expect(processImage('cover', gif)).rejects.toEqual(code('image_unsupported'));
    await expect(processImage('cover', await png(200, 100))).rejects.toEqual(
      code('image_too_small'),
    );
    await expect(processImage('logo', Buffer.alloc(3 * 1024 * 1024, 1))).rejects.toEqual(
      code('image_too_large'),
    );
    // A PNG header followed by garbage.
    const broken = Buffer.concat([(await png(800, 600)).subarray(0, 40), Buffer.alloc(200)]);
    await expect(processImage('cover', broken)).rejects.toEqual(code('image_unsupported'));
  });
});

/** A tiny S3 stand-in: enough of the protocol to prove the adapter's requests and responses. */
function fakeS3() {
  const objects = new Map<string, { body: Buffer; type: string }>();
  const seen: { method: string; url: string; auth: string | undefined }[] = [];
  const server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const path = decodeURIComponent(new URL(req.url!, 'http://x').pathname);
    seen.push({ method: req.method!, url: path, auth: req.headers.authorization });
    if (req.method === 'PUT') {
      objects.set(path, { body: Buffer.concat(chunks), type: String(req.headers['content-type']) });
      res.writeHead(200, { ETag: '"1"' }).end();
    } else if (req.method === 'GET') {
      const o = objects.get(path);
      if (!o) {
        res
          .writeHead(404, { 'content-type': 'application/xml' })
          .end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>none</Message></Error>');
      } else {
        res.writeHead(200, { 'content-type': o.type, 'content-length': o.body.length }).end(o.body);
      }
    } else if (req.method === 'DELETE') {
      objects.delete(path);
      res.writeHead(204).end();
    } else {
      res.writeHead(400).end();
    }
  });
  return { server, objects, seen };
}

describe('S3-compatible storage adapter', () => {
  const s3 = fakeS3();
  let storage: S3Storage;

  beforeAll(async () => {
    await new Promise<void>((r) => s3.server.listen(0, '127.0.0.1', r));
    const { port } = s3.server.address() as AddressInfo;
    storage = new S3Storage({
      endpoint: `http://127.0.0.1:${port}`,
      region: 'sa-riyadh-1',
      bucket: 'guest-media',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      forcePathStyle: true,
    });
  });
  afterAll(() => new Promise<void>((r) => s3.server.close(() => r())));

  it('puts, gets and deletes private objects with signed requests', async () => {
    const key = 'event-media/AbCdEfGhIjKlMnOpQrStUv.webp';
    await storage.put(key, Buffer.from('image-bytes'), 'image/webp');
    expect(s3.objects.get(`/guest-media/${key}`)?.type).toBe('image/webp');
    expect(await storage.get(key)).toEqual({
      body: Buffer.from('image-bytes'),
      contentType: 'image/webp',
    });
    await storage.delete(key);
    expect(await storage.get(key)).toBeNull();
    expect(s3.seen.every((r) => r.auth?.startsWith('AWS4-HMAC-SHA256 Credential=test-key/'))).toBe(
      true,
    );
    expect(JSON.stringify(s3.seen)).not.toContain('test-secret');
  });

  it('accepts only keys the app generates', async () => {
    await expect(storage.put('../escape.webp', Buffer.from('x'), 'image/webp')).rejects.toThrow();
    await expect(storage.get('event-media/short.webp')).rejects.toThrow();
  });
});

describe.skipIf(!databaseUrl)('event image uploads', () => {
  const ctx = createTestContext(new Date('2035-01-01T09:00:00Z'));

  it('stores a cover, replaces it, and serves it to guests only once published', async () => {
    const owner = await createOwner(ctx);
    const stranger = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));

    const first = await uploadEventImage(ctx, owner.userId, eventId, 'cover', await png(1200, 700));
    expect(first.key).toMatch(/^event-media\/[0-9A-Za-z]{22}\.webp$/);
    expect(ctx.storage.objects.has(first.key)).toBe(true);

    // Draft: only the owner (for the preview) can load it.
    expect(await readEventImage(ctx, first.key, null)).toBeNull();
    expect(await readEventImage(ctx, first.key, stranger.userId)).toBeNull();
    expect((await readEventImage(ctx, first.key, owner.userId))?.contentType).toBe('image/webp');

    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    expect(await readEventImage(ctx, first.key, null)).not.toBeNull();

    const second = await uploadEventImage(
      ctx,
      owner.userId,
      eventId,
      'cover',
      await png(1200, 700),
    );
    expect(ctx.storage.objects.has(first.key)).toBe(false);
    expect(await readEventImage(ctx, first.key, owner.userId)).toBeNull();

    await removeEventImage(ctx, owner.userId, eventId, 'cover');
    expect(ctx.storage.objects.has(second.key)).toBe(false);

    await expect(
      uploadEventImage(ctx, stranger.userId, eventId, 'logo', await png(300, 300)),
    ).rejects.toEqual(code('not_found'));
    expect(await readEventImage(ctx, '../../etc/passwd', owner.userId)).toBeNull();
  });

  it('keeps nothing in storage when the upload is refused', async () => {
    const owner = await createOwner(ctx);
    const { eventId } = await createEvent(ctx, owner.userId, eventInput(ctx));
    const before = ctx.storage.objects.size;
    await transitionEvent(ctx, owner.userId, eventId, 'activate');
    await transitionEvent(ctx, owner.userId, eventId, 'cancel', { reason: 'تأجيل' });
    await expect(
      uploadEventImage(ctx, owner.userId, eventId, 'cover', await png(1200, 700)),
    ).rejects.toEqual(code('event_not_editable'));
    expect(ctx.storage.objects.size).toBe(before);
  });
});
