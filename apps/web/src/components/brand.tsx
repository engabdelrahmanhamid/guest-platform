import Link from 'next/link';
import { Icon } from './icons';

export function Brand({ name, href = '/' }: { name: string; href?: string }) {
  return (
    <Link href={href} className="brand">
      <span className="brand-mark" aria-hidden="true">
        <Icon name="logo" />
      </span>
      <span>{name}</span>
    </Link>
  );
}
