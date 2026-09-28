import type { Metadata } from 'next';
import { ComingSoon } from '@/components/coming-soon';

export const metadata: Metadata = { title: 'الرسائل' };

export default function MessagesPage() {
  return <ComingSoon area="messages" icon="chat" />;
}
