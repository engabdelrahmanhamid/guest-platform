import type { ReactNode } from 'react';
import { ProductShell } from '@/components/product-shell';

export default function DevLayout({ children }: { children: ReactNode }) {
  return <ProductShell>{children}</ProductShell>;
}
