'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { type ButtonVariant, buttonClass } from './button';

/**
 * A submit button carrying its own name/value. With `confirm`, the first press asks in place
 * (question, confirm and back buttons) instead of a browser dialog; only the confirm button
 * submits.
 */
export function ConfirmSubmit({
  name,
  value,
  confirm,
  confirmLabel,
  variant = 'primary',
  size,
  className,
  children,
}: {
  name: string;
  value: string;
  /** The question shown before submitting. Omit to submit on the first press. */
  confirm?: string;
  /** Text of the confirming button; defaults to the button's own label. */
  confirmLabel?: string;
  variant?: ButtonVariant;
  size?: 'sm';
  className?: string;
  children: ReactNode;
}) {
  const t = useTranslations('common');
  const { pending } = useFormStatus();
  const [asking, setAsking] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const wasAsking = useRef(false);

  useEffect(() => {
    if (asking) yes.current?.focus();
    else if (wasAsking.current) trigger.current?.focus();
    wasAsking.current = asking;
  }, [asking]);

  const danger = variant === 'danger' || variant === 'danger-solid';
  if (confirm && asking) {
    return (
      <span
        className={`confirm-box${danger ? ' is-danger' : ''}`}
        role="group"
        aria-label={confirm}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setAsking(false);
        }}
      >
        <span className="q">{confirm}</span>
        <button
          ref={yes}
          type="submit"
          name={name}
          value={value}
          className={buttonClass(danger ? 'danger-solid' : 'primary', 'sm')}
          disabled={pending}
          aria-busy={pending || undefined}
        >
          {confirmLabel ?? children}
        </button>
        <button
          type="button"
          className={buttonClass('ghost', 'sm')}
          onClick={() => setAsking(false)}
          disabled={pending}
        >
          {t('back')}
        </button>
      </span>
    );
  }
  return (
    <button
      ref={trigger}
      type={confirm ? 'button' : 'submit'}
      name={confirm ? undefined : name}
      value={confirm ? undefined : value}
      className={className ?? buttonClass(variant, size)}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={confirm ? () => setAsking(true) : undefined}
    >
      {children}
    </button>
  );
}
