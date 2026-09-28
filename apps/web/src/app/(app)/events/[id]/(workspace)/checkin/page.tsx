import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'الاستقبال' };

export default function CheckinPage() {
  return <ComingSoon area="checkin" icon="scan" />;
}
