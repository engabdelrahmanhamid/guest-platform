'use client';

import { useTranslations } from 'next-intl';
import {
  type ComponentProps,
  createContext,
  type ReactNode,
  useActionState,
  useContext,
} from 'react';
import { useFormStatus } from 'react-dom';
import { type ButtonVariant, buttonClass } from './button';
import { Icon } from './icons';

export interface FormState {
  ok?: boolean;
  error?: string;
  fields?: Record<string, string>;
  message?: string;
  values?: Record<string, string>;
  /** Extra values an action hands back to the page (e.g. a TOTP enrollment secret). */
  data?: Record<string, string>;
}

type Action = (prev: FormState, data: FormData) => Promise<FormState>;

const StateContext = createContext<FormState>({});

/** A form bound to a server action. Shows the translated error and keeps typed values on failure. */
export function ActionForm({
  action,
  children,
  className,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations();
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className ?? 'form'} noValidate>
      <StateContext value={state}>
        {state.error && (
          <p role="alert" className="alert alert-error">
            <Icon name="alert" />
            <span className="grow">
              {t.has(`errors.${state.error}`) ? t(`errors.${state.error}`) : t('errors.generic')}
            </span>
          </p>
        )}
        {state.ok && state.message && (
          <p role="status" className="alert alert-ok">
            <Icon name="checkCircle" />
            <span className="grow">{t(state.message)}</span>
          </p>
        )}
        {children}
      </StateContext>
    </form>
  );
}

function useFieldError(name: string): string | undefined {
  const t = useTranslations('fields');
  const code = useContext(StateContext).fields?.[name];
  if (!code) return undefined;
  return t.has(code) ? t(code) : t('invalid');
}

type InputProps = Omit<ComponentProps<'input'>, 'name'> & {
  name: string;
  label: string;
  hint?: string;
  /** Rendered at the far end of the label row, e.g. a "forgot password" link. */
  aside?: ReactNode;
};

/** Emails, phone numbers and links are typed and read left to right inside RTL screens. */
const LTR_TYPES = new Set(['email', 'tel', 'url']);

/** Field label. Required fields carry a marker; everything else is optional by convention. */
function Label({
  id,
  label,
  required,
  aside,
}: {
  id: string;
  label: string;
  required?: boolean | undefined;
  aside?: ReactNode;
}) {
  const t = useTranslations('common');
  const text = (
    <label htmlFor={id}>
      {label}
      {required && (
        <>
          <span className="req" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> ({t('required')})</span>
        </>
      )}
    </label>
  );
  return aside ? (
    <div className="field-row">
      {text}
      <span className="small">{aside}</span>
    </div>
  ) : (
    text
  );
}

function FieldMessage({ id, error, hint }: { id: string; error?: string; hint?: string }) {
  if (error) {
    return (
      <p id={`${id}-desc`} className="field-error">
        <Icon name="alert" />
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={`${id}-desc`} className="field-hint">
      {hint}
    </p>
  ) : null;
}

export function Field({
  name,
  label,
  hint,
  aside,
  defaultValue,
  type = 'text',
  required,
  ...rest
}: InputProps) {
  const state = useContext(StateContext);
  const error = useFieldError(name);
  const id = `f-${name}`;
  const value = state.values?.[name] ?? defaultValue;
  return (
    <div className="field">
      <Label id={id} label={label} required={required} aside={aside} />
      <input
        id={id}
        name={name}
        type={type}
        dir={LTR_TYPES.has(type) ? 'ltr' : undefined}
        defaultValue={type === 'password' ? undefined : value}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-desc` : undefined}
        {...rest}
      />
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

export function TextArea({
  name,
  label,
  hint,
  defaultValue,
  required,
  ...rest
}: Omit<ComponentProps<'textarea'>, 'name'> & {
  name: string;
  label: string;
  hint?: string;
}) {
  const state = useContext(StateContext);
  const error = useFieldError(name);
  const id = `f-${name}`;
  return (
    <div className="field">
      <Label id={id} label={label} required={required} />
      <textarea
        id={id}
        name={name}
        defaultValue={state.values?.[name] ?? defaultValue}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-desc` : undefined}
        {...rest}
      />
      <FieldMessage id={id} error={error} hint={hint} />
    </div>
  );
}

export function Select({
  name,
  label,
  defaultValue,
  options,
}: {
  name: string;
  label: string;
  defaultValue?: string;
  options: { value: string; label: string }[];
}) {
  const state = useContext(StateContext);
  const error = useFieldError(name);
  const id = `f-${name}`;
  return (
    <div className="field">
      <Label id={id} label={label} />
      <select
        id={id}
        name={name}
        defaultValue={state.values?.[name] ?? defaultValue}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-desc` : undefined}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <FieldMessage id={id} error={error} />
    </div>
  );
}

export function Checkbox({
  name,
  label,
  defaultChecked,
}: {
  name: string;
  label: string;
  defaultChecked?: boolean;
}) {
  const state = useContext(StateContext);
  const checked = state.values ? state.values[name] === 'on' : defaultChecked;
  return (
    <label className="checkbox">
      <input type="checkbox" name={name} defaultChecked={checked} />
      <span>{label}</span>
    </label>
  );
}

export function SubmitButton({
  children,
  variant = 'primary',
  size,
  block,
}: {
  children: ReactNode;
  variant?: ButtonVariant;
  size?: 'sm';
  block?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={buttonClass(variant, size, block)}
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {children}
    </button>
  );
}
