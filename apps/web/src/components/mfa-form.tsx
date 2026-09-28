'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';
import { ActionForm, Field, type FormState, SubmitButton } from './forms';

type Action = (prev: FormState, data: FormData) => Promise<FormState>;

/** Enrollment: start → show the key → confirm with a code. Verification: just the code. */
export function MfaForm({
  enrolled,
  begin,
  confirm,
}: {
  enrolled: boolean;
  begin: (prev: FormState) => Promise<FormState>;
  confirm: Action;
}) {
  const t = useTranslations('auth');
  const [started, startAction] = useActionState(begin, {});
  const secret = started.data?.secret;

  if (!enrolled && !secret) {
    return (
      <>
        <p>{t('mfaEnrollIntro')}</p>
        <form action={startAction}>
          <SubmitButton>{t('mfaStart')}</SubmitButton>
        </form>
      </>
    );
  }
  return (
    <>
      {secret ? (
        <>
          <p>{t('mfaEnrollIntro')}</p>
          <p>
            {t('mfaSecret')}: <code className="ltr">{secret.match(/.{1,4}/g)?.join(' ')}</code>
          </p>
          <p>
            <a href={started.data?.uri}>{t('mfaOpenApp')}</a>
          </p>
        </>
      ) : (
        <p>{t('mfaVerifyIntro')}</p>
      )}
      <ActionForm action={confirm}>
        <Field
          name="code"
          label={t('mfaCode')}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          className="ltr"
          required
        />
        <SubmitButton>{t('mfaSubmit')}</SubmitButton>
      </ActionForm>
    </>
  );
}
