'use client';

import { useTranslations } from 'next-intl';
import {
  ActionForm,
  Checkbox,
  Field,
  type FormState,
  Select,
  SubmitButton,
  TextArea,
} from './forms';

export interface EventFormValues {
  category: string;
  type: string;
  name?: string;
  startsAt?: string;
  endsAt?: string;
  timezone: string;
  city?: string;
  venueName?: string;
  address?: string;
  mapsUrl?: string;
  description?: string;
  defaultAllowedCompanions: number;
  autoOpenCheckin: boolean;
  checkinOpensOffsetMin: number;
  assumedDurationMin: number;
  autoCloseCheckin: boolean;
  checkinClosesOffsetMin: number;
  reopenWindowMin: number;
}

/** Create and edit share this form. Values come in the event's local time. */
export function EventForm({
  action,
  values,
  timezones,
  submitLabel,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  values: EventFormValues;
  timezones: string[];
  submitLabel: string;
}) {
  const t = useTranslations('eventForm');
  return (
    <ActionForm action={action}>
      <input type="hidden" name="category" value={values.category} />
      <input type="hidden" name="type" value={values.type} />
      <Field name="name" label={t('name')} defaultValue={values.name} required maxLength={150} />
      <div className="grid-2">
        <Field
          name="startsAt"
          type="datetime-local"
          label={t('startsAt')}
          defaultValue={values.startsAt}
          required
        />
        <Field
          name="endsAt"
          type="datetime-local"
          label={t('endsAt')}
          defaultValue={values.endsAt}
          hint={t('endsAtHint', { minutes: values.assumedDurationMin })}
        />
      </div>
      <Select
        name="timezone"
        label={t('timezone')}
        defaultValue={values.timezone}
        options={timezones.map((z) => ({ value: z, label: z }))}
      />
      <div className="grid-2">
        <Field name="city" label={t('city')} defaultValue={values.city} required maxLength={80} />
        <Field
          name="venueName"
          label={t('venueName')}
          defaultValue={values.venueName}
          required
          maxLength={150}
        />
      </div>
      <Field name="address" label={t('address')} defaultValue={values.address} maxLength={300} />
      <Field
        name="mapsUrl"
        type="url"
        label={t('mapsUrl')}
        defaultValue={values.mapsUrl}
        placeholder="https://maps.google.com/…"
      />
      <TextArea
        name="description"
        label={t('description')}
        defaultValue={values.description}
        rows={3}
        maxLength={1000}
      />
      <Field
        name="defaultAllowedCompanions"
        type="number"
        min={0}
        max={20}
        label={t('defaultAllowedCompanions')}
        defaultValue={values.defaultAllowedCompanions}
      />
      <fieldset>
        <legend>{t('lifecycleTitle')}</legend>
        <p className="field-hint">{t('lifecycleHint')}</p>
        <Checkbox
          name="lifecycle.autoOpenCheckin"
          label={t('autoOpenCheckin')}
          defaultChecked={values.autoOpenCheckin}
        />
        <Field
          name="lifecycle.checkinOpensBeforeMin"
          type="number"
          min={0}
          max={10080}
          label={t('checkinOpensOffsetMin')}
          defaultValue={-values.checkinOpensOffsetMin}
        />
        <Field
          name="lifecycle.assumedDurationMin"
          type="number"
          min={30}
          max={4320}
          label={t('assumedDurationMin')}
          defaultValue={values.assumedDurationMin}
        />
        <Checkbox
          name="lifecycle.autoCloseCheckin"
          label={t('autoCloseCheckin')}
          defaultChecked={values.autoCloseCheckin}
        />
        <Field
          name="lifecycle.checkinClosesOffsetMin"
          type="number"
          min={0}
          max={4320}
          label={t('checkinClosesOffsetMin')}
          defaultValue={values.checkinClosesOffsetMin}
        />
        <Field
          name="lifecycle.reopenWindowMin"
          type="number"
          min={0}
          max={10080}
          label={t('reopenWindowMin')}
          defaultValue={values.reopenWindowMin}
        />
      </fieldset>
      <div>
        <SubmitButton>{submitLabel}</SubmitButton>
      </div>
    </ActionForm>
  );
}
