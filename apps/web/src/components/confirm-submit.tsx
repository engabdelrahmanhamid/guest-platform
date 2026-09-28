'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

/** A submit button carrying its own name/value, with a confirmation prompt. */
export function ConfirmSubmit({
  name,
  value,
  confirm,
  variant = 'primary',
  size,
  children,
}: {
  name: string;
  value: string;
  confirm?: string;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm';
  children: ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}`}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
