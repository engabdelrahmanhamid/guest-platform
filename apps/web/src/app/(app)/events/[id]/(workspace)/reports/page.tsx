import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'التقارير' };

export default function ReportsPage() {
  return <ComingSoon area="reports" icon="chart" />;
}
