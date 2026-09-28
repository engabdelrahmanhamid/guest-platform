'use client';

import { useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';
import { type FormState, ActionForm, SubmitButton } from '../forms';
import { Icon } from '../icons';

/** File picker plus a visible "uploading and reading" state while the server parses. */
export function UploadForm({
  action,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
}) {
  const t = useTranslations('guests.import');
  return (
    <ActionForm action={action} className="form upload-form">
      <Picker />
      <div className="form-actions">
        <SubmitButton>
          <Icon name="upload" />
          {t('upload')}
        </SubmitButton>
        <Progress />
      </div>
    </ActionForm>
  );
}

function Picker() {
  const t = useTranslations('guests.import');
  const { pending } = useFormStatus();
  return (
    <label className={`dropzone${pending ? ' is-busy' : ''}`}>
      <Icon name="file" />
      <span className="dz-title">{t('file')}</span>
      <span className="dz-hint">{t('fileHint')}</span>
      <input
        type="file"
        name="file"
        required
        disabled={pending}
        accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
      />
    </label>
  );
}

function Progress() {
  const t = useTranslations('guests.import');
  const { pending } = useFormStatus();
  return pending ? (
    <span className="busy" role="status">
      <span className="spinner" aria-hidden="true" />
      {t('uploading')}
    </span>
  ) : null;
}
