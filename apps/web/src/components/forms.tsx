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
  /** Shown after the label, e.g. "(اختياري)". */
  optional?: string;
  /** Rendered at the far end of the label row, e.g. a "forgot password" link. */
  aside?: ReactNode;
};

function Label({
  id,
  label,
  optional,
  aside,
}: {
  id: string;
  label: string;
  optional?: string | undefined;
  aside?: ReactNode;
}) {
  const text = (
    <label htmlFor={id}>
      {label} {optional && <span className="opt">({optional})</span>}
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

export function Field({
  name,
  label,
  hint,
  optional,
  aside,
  defaultValue,
  type = 'text',
  ...rest
}: InputProps) {
  const state = useContext(StateContext);
  const error = useFieldError(name);
  const id = `f-${name}`;
  const value = state.values?.[name] ?? defaultValue;
  return (
    <div className="field">
      <Label id={id} label={label} optional={optional} aside={aside} />
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={type === 'password' ? undefined : value}
        aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-desc` : undefined}
        {...rest}
      />
      {(error || hint) && (
        <p id={`${id}-desc`} className={error ? 'field-error' : 'field-hint'}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}

export function TextArea({
  name,
  label,
  optional,
  hint,
  defaultValue,
  ...rest
}: Omit<ComponentProps<'textarea'>, 'name'> & {
  name: string;
  label: string;
  optional?: string;
  hint?: string;
}) {
  const state = useContext(StateContext);
  const error = useFieldError(name);
  const id = `f-${name}`;
  return (
    <div className="field">
      <Label id={id} label={label} optional={optional} />
      <textarea
        id={id}
        name={name}
        defaultValue={state.values?.[name] ?? defaultValue}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
      {(error || hint) && <p className={error ? 'field-error' : 'field-hint'}>{error ?? hint}</p>}
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
      <label htmlFor={id}>{label}</label>
      <select id={id} name={name} defaultValue={state.values?.[name] ?? defaultValue}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <p className="field-error">{error}</p>}
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
  confirm,
  size,
  block,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'danger' | 'danger-solid' | 'ghost' | 'link';
  confirm?: string;
  size?: 'sm';
  block?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={`btn btn-${variant}${size ? ` btn-${size}` : ''}${block ? ' btn-block' : ''}`}
      disabled={pending}
      aria-busy={pending || undefined}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
