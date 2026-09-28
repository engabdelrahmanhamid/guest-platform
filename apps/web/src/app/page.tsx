import { redirect } from 'next/navigation';
import { getPrincipal } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  redirect((await getPrincipal()) ? '/dashboard' : '/login');
}
