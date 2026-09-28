'use client';

import Link from 'next/link';
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
import { Icon } from './icons';

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
  cancelHref,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  values: EventFormValues;
  timezones: { value: string; label: string }[];
  submitLabel: string;
  cancelHref: string;
}) {
  const t = useTranslations('eventForm');
  const tc = useTranslations('common');
  const optional = tc('optional');
  return (
    <ActionForm action={action}>
      <input type="hidden" name="category" value={values.category} />
      <input type="hidden" name="type" value={values.type} />

      <section className="form-section">
        <header>
          <h2>{t('sectionBasics')}</h2>
        </header>
        <Field
          name="name"
          label={t('name')}
          defaultValue={values.name}
          placeholder={t('namePlaceholder')}
          required
          maxLength={150}
        />
        <TextArea
          name="description"
          label={t('description')}
          optional={optional}
          hint={t('descriptionHint')}
          defaultValue={values.description}
          rows={3}
          maxLength={1000}
        />
      </section>

      <section className="form-section">
        <header>
          <h2>{t('sectionWhen')}</h2>
        </header>
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
            optional={optional}
            defaultValue={values.endsAt}
            hint={t('endsAtHint', { hours: Math.round(values.assumedDurationMin / 60) })}
          />
        </div>
        <Select
          name="timezone"
          label={t('timezone')}
          defaultValue={values.timezone}
          options={timezones}
        />
      </section>

      <section className="form-section">
        <header>
          <h2>{t('sectionWhere')}</h2>
        </header>
        <div className="grid-2">
          <Field
            name="venueName"
            label={t('venueName')}
            defaultValue={values.venueName}
            placeholder={t('venuePlaceholder')}
            required
            maxLength={150}
          />
          <Field
            name="city"
            label={t('city')}
            defaultValue={values.city}
            placeholder={t('cityPlaceholder')}
            required
            maxLength={80}
          />
        </div>
        <Field
          name="address"
          label={t('address')}
          optional={optional}
          defaultValue={values.address}
          maxLength={300}
        />
        <Field
          name="mapsUrl"
          type="url"
          label={t('mapsUrl')}
          optional={optional}
          defaultValue={values.mapsUrl}
          hint={t('mapsUrlHint')}
          placeholder="https://maps.app.goo.gl/…"
        />
      </section>

      <section className="form-section">
        <header>
          <h2>{t('sectionGuests')}</h2>
          <p>{t('sectionGuestsHint')}</p>
        </header>
        <div style={{ maxInlineSize: 260 }}>
          <Field
            name="defaultAllowedCompanions"
            type="number"
            min={0}
            max={20}
            label={t('defaultAllowedCompanions')}
            defaultValue={values.defaultAllowedCompanions}
          />
        </div>
      </section>

      <section className="form-section">
        <details className="advanced">
          <summary>
            <span>
              {t('lifecycleTitle')}
              <span className="field-hint" style={{ display: 'block', fontWeight: 400 }}>
                {t('lifecycleHint')}
              </span>
            </span>
            <span className="chev">
              <Icon name="chevron" />
            </span>
          </summary>
          <div className="body">
            <Checkbox
              name="lifecycle.autoOpenCheckin"
              label={t('autoOpenCheckin')}
              defaultChecked={values.autoOpenCheckin}
            />
            <div className="grid-2">
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
            </div>
            <Checkbox
              name="lifecycle.autoCloseCheckin"
              label={t('autoCloseCheckin')}
              defaultChecked={values.autoCloseCheckin}
            />
            <div className="grid-2">
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
            </div>
          </div>
        </details>
      </section>

      <div className="form-actions">
        <SubmitButton>{submitLabel}</SubmitButton>
        <Link href={cancelHref} className="btn btn-ghost">
          {tc('cancel')}
        </Link>
      </div>
    </ActionForm>
  );
}
