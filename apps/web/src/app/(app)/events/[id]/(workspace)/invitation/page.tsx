import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'الدعوة' };

export default function InvitationPage() {
  return <ComingSoon area="invitation" icon="envelope" />;
}
