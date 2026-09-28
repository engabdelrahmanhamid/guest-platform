import {
  guardPublicRequest,
  isDomainError,
  noteUnknownToken,
  recordInvitationOpen,
} from '@gp/core';
import { publicClient } from '@/lib/public';
import { getCoreContext, getLogger } from '@/lib/server';

export const dynamic = 'force-dynamic';

/**
 * The guest page's open beacon. Only a real browser that ran the page's script calls it, so link
 * previews and crawlers never count as opens. Always answers 204, so it reveals nothing.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = getCoreContext();
  const client = await publicClient();
  try {
    await guardPublicRequest(ctx.db, 'open', client, token, ctx.now());
    const known = await recordInvitationOpen(ctx, token);
    if (!known) await noteUnknownToken(ctx.db, client, ctx.now());
  } catch (err) {
    if (!isDomainError(err, 'rate_limited')) getLogger().error({ err }, 'open beacon failed');
  }
  return new Response(null, { status: 204 });
}
