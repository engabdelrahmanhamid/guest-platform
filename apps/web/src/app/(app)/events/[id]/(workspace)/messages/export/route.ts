import { exportInvitationLinks, isDomainError } from '@gp/core';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** Every active guest's name, phone, personal link and group, for trusted helpers to share. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await requirePrincipal();
  let result;
  try {
    result = await exportInvitationLinks(getCoreContext(), principal.user.id, id);
  } catch (err) {
    if (isDomainError(err, 'not_found') || isDomainError(err, 'forbidden')) {
      return new Response('Not found', { status: 404 });
    }
    if (isDomainError(err)) {
      return Response.redirect(new URL(`/events/${id}/messages?e=${err.code}`, _req.url), 303);
    }
    throw err;
  }
  return new Response(Buffer.from(result.file), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="invitation-links.xlsx"; filename*=UTF-8''${encodeURIComponent(`روابط-الدعوات.xlsx`)}`,
      'cache-control': 'private, no-store',
    },
  });
}
