import { pingDatabase } from '@gp/db';
import { getLogger, getPool } from '@/lib/server';

export const dynamic = 'force-dynamic';

// Used by the load balancer and uptime checks. Reports only up/down, never details.
export async function GET() {
  try {
    await pingDatabase(getPool());
    return Response.json({ status: 'ok' });
  } catch (err) {
    getLogger().error({ err }, 'health check failed');
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
