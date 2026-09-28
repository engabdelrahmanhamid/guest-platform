import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'الضيوف' };

export default function GuestsPage() {
  return <ComingSoon area="guests" icon="users" />;
}
