'use client';

import { useTranslations } from 'next-intl';
import { useFormStatus } from 'react-dom';
import { ConfirmSubmit } from '../confirm-submit';
import { type FormState, ActionForm } from '../forms';

/** The commit button: asks once, then shows "importing…" until the server is done. */
export function CommitBar({
  action,
  count,
  blocked,
}: {
  action: (prev: FormState) => Promise<FormState>;
  count: number;
  blocked: boolean;
}) {
  const t = useTranslations('guests.import.review');
  return (
    <ActionForm action={action} className="inline-form commit-form">
      {blocked || count === 0 ? (
        <button type="button" className="btn btn-primary" disabled aria-disabled="true">
          {t('commit', { count })}
        </button>
      ) : (
        <ConfirmSubmit name="op" value="commit" confirm={t('commitConfirm', { count })}>
          {t('commit', { count })}
        </ConfirmSubmit>
      )}
      <Pending />
    </ActionForm>
  );
}

function Pending() {
  const t = useTranslations('guests.import.review');
  const { pending } = useFormStatus();
  return pending ? (
    <span className="busy" role="status">
      <span className="spinner" aria-hidden="true" />
      {t('committing')}
    </span>
  ) : null;
}
