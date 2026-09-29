import { attendance } from '@gp/db/schema';
import { eq } from 'drizzle-orm';
import type { DbOrTx } from '../shared/context';

/** How many of the guest's party are checked in now (0 when nobody has arrived). */
export async function checkedInCount(db: DbOrTx, guestId: string): Promise<number> {
  const [row] = await db
    .select({ n: attendance.checkedInCount })
    .from(attendance)
    .where(eq(attendance.guestId, guestId));
  return row?.n ?? 0;
}
