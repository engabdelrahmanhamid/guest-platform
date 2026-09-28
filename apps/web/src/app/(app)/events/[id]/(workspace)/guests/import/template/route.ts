import { importTemplate, isDomainError, requireGuestView } from '@gp/core';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

/** The empty guest-list template (owner only, so the file is never public). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const principal = await requirePrincipal();
  try {
    await requireGuestView(getCoreContext().db, principal.user.id, id);
  } catch (err) {
    if (isDomainError(err)) return new Response('Not found', { status: 404 });
    throw err;
  }
  return new Response(Buffer.from(importTemplate()), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="guests-template.xlsx"; filename*=UTF-8''${encodeURIComponent('قالب-الضيوف.xlsx')}`,
      'cache-control': 'private, no-store',
    },
  });
}
