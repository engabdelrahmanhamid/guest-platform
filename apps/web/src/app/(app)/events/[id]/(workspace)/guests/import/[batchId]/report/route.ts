import { importProblemReport, isDomainError, type RowIssue } from '@gp/core';
import { getTranslations } from 'next-intl/server';
import { UUID } from '@/lib/guests';
import { getCoreContext } from '@/lib/server';
import { requirePrincipal } from '@/lib/session';

/** The rows of an import that were not (or will not be) imported, with the reason for each. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; batchId: string }> },
) {
  const { id, batchId } = await params;
  if (!UUID.test(batchId)) return new Response('Not found', { status: 404 });
  const principal = await requirePrincipal();
  const t = await getTranslations('guests.import');
  const describe = (issue: RowIssue) => {
    const short = `issues.${issue.code}Short`;
    if (t.has(short)) return t(short);
    const key = `issues.${issue.code}`;
    return t.has(key) ? t(key, { row: String(issue.row ?? '') }) : issue.code;
  };
  let bytes: Uint8Array;
  try {
    bytes = await importProblemReport(getCoreContext(), principal.user.id, id, batchId, {
      row: t('reportRow'),
      problem: t('reportProblem'),
      describe,
    });
  } catch (err) {
    if (isDomainError(err)) return new Response('Not found', { status: 404 });
    throw err;
  }
  return new Response(Buffer.from(bytes), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="import-review.xlsx"; filename*=UTF-8''${encodeURIComponent('مراجعة-الاستيراد.xlsx')}`,
      'cache-control': 'private, no-store',
    },
  });
}
