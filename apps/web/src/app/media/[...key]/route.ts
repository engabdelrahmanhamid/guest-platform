import { readEventImage } from '@gp/core';
import { getCoreContext, getLogger } from '@/lib/server';
import { getPrincipal } from '@/lib/session';

export const dynamic = 'force-dynamic';

/**
 * Event covers and logos, streamed from private storage after an access check: anyone once the
 * event is published, only its owner before. Keys are random and never reused, so published
 * images can be cached for good.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join('/');
  try {
    const principal = await getPrincipal();
    const image = await readEventImage(getCoreContext(), key, principal?.user.id ?? null);
    if (!image) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(image.body), {
      headers: {
        'Content-Type': image.contentType,
        'Content-Length': String(image.body.length),
        'Cache-Control': image.isPublic
          ? 'public, max-age=31536000, immutable'
          : 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'",
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    });
  } catch (err) {
    getLogger().error({ err }, 'media read failed');
    return new Response('Unavailable', { status: 503 });
  }
}
