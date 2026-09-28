'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';
import { buttonClass } from '../button';
import {
  type FormState,
  ActionForm,
  Field,
  Select,
  SubmitButton,
  TextArea,
  useActionFormState,
} from '../forms';
import { Icon } from '../icons';

export interface GuestFormValues {
  fullName?: string;
  phone?: string;
  email?: string;
  groupId?: string;
  allowedCompanions?: string;
  notes?: string;
}

interface Duplicate {
  id: string;
  fullName: string;
  phoneE164: string | null;
  groupName: string | null;
  status: 'active' | 'cancelled';
}

/**
 * Add and edit share this form. When the phone matches another guest the save comes back with
 * the matches; the owner sees who they are and either goes back or adds anyway.
 */
export function GuestForm({
  action,
  mode,
  values = {},
  groups,
  defaultCompanions,
  returnTo,
  cancelHref,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  mode: 'add' | 'edit';
  values?: GuestFormValues;
  groups: { id: string; name: string }[];
  defaultCompanions: number;
  returnTo: string;
  cancelHref: string;
}) {
  return (
    <ActionForm action={action} className="form guest-form" quiet={['duplicate_phone']}>
      <input type="hidden" name="returnTo" value={returnTo} />
      <DuplicateWarning cancelHref={cancelHref} />
      <Fields mode={mode} values={values} groups={groups} defaultCompanions={defaultCompanions} />
      <Actions mode={mode} cancelHref={cancelHref} />
    </ActionForm>
  );
}

function Fields({
  mode,
  values,
  groups,
  defaultCompanions,
}: {
  mode: 'add' | 'edit';
  values: GuestFormValues;
  groups: { id: string; name: string }[];
  defaultCompanions: number;
}) {
  const t = useTranslations('guests.form');
  const state = useActionFormState();
  // After "Add & add another" the form is cleared but keeps the group just used.
  const groupDefault = state.ok ? (state.data?.groupId ?? '') : (values.groupId ?? '');
  return (
    <>
      <Field
        name="fullName"
        label={t('name')}
        required
        defaultValue={values.fullName}
        autoComplete="off"
        maxLength={150}
      />
      <Field
        name="phone"
        label={t('phone')}
        type="tel"
        required
        defaultValue={values.phone}
        hint={t('phoneHint')}
        autoComplete="off"
        inputMode="tel"
      />
      <Field
        name="email"
        label={t('email')}
        type="email"
        defaultValue={values.email}
        hint={t('emailHint')}
      />
      <div className="field-pair">
        <Select
          name="groupId"
          label={t('group')}
          defaultValue={groupDefault}
          options={[
            { value: '', label: t('noGroup') },
            ...groups.map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
        <Field
          name="allowedCompanions"
          label={t('companions')}
          type="number"
          min={0}
          max={20}
          inputMode="numeric"
          defaultValue={mode === 'add' ? String(defaultCompanions) : values.allowedCompanions}
          hint={mode === 'add' ? t('companionsHint', { n: defaultCompanions }) : undefined}
        />
      </div>
      <TextArea
        name="notes"
        label={t('notes')}
        rows={3}
        maxLength={1000}
        defaultValue={values.notes}
        hint={t('notesHint')}
      />
    </>
  );
}

function DuplicateWarning({ cancelHref }: { cancelHref: string }) {
  const t = useTranslations('guests');
  const state = useActionFormState();
  const { pending } = useFormStatus();
  if (state.error !== 'duplicate_phone' || !state.data?.duplicates) return null;
  const duplicates = JSON.parse(state.data.duplicates) as Duplicate[];
  return (
    <div className="dup-warn" role="alert">
      <p className="dup-title">
        <Icon name="alert" />
        {t('duplicate.title')}
      </p>
      <ul className="dup-list">
        {duplicates.map((d) => (
          <li key={d.id}>
            <strong>{d.fullName}</strong>
            <span>{d.groupName ?? t('noGroup')}</span>
            <span dir="ltr" className="num">
              {d.phoneE164}
            </span>
            {d.status === 'cancelled' && <span className="tag">{t('status.cancelled')}</span>}
          </li>
        ))}
      </ul>
      <p className="dup-note">{t('duplicate.note')}</p>
      {state.values?.intent === 'another' && <input type="hidden" name="intent" value="another" />}
      <div className="row-tight">
        <button
          type="submit"
          name="allowDuplicate"
          value="1"
          className={buttonClass('primary', 'sm')}
          disabled={pending}
        >
          {t('duplicate.addAnyway')}
        </button>
        <Link href={cancelHref} scroll={false} className={buttonClass('ghost', 'sm')}>
          {t('duplicate.cancel')}
        </Link>
      </div>
    </div>
  );
}

function Actions({ mode, cancelHref }: { mode: 'add' | 'edit'; cancelHref: string }) {
  const t = useTranslations('guests.form');
  const state = useActionFormState();
  const { pending } = useFormStatus();
  if (state.error === 'duplicate_phone') return null;
  return (
    <div className="form-actions">
      {mode === 'add' ? (
        <>
          <SubmitButton>
            <Icon name="plus" />
            {t('add')}
          </SubmitButton>
          <button
            type="submit"
            name="intent"
            value="another"
            className={buttonClass('secondary')}
            disabled={pending}
          >
            {t('addAnother')}
          </button>
        </>
      ) : (
        <SubmitButton>{t('save')}</SubmitButton>
      )}
      <Link href={cancelHref} scroll={false} className={buttonClass('ghost')}>
        {t('cancel')}
      </Link>
    </div>
  );
}
