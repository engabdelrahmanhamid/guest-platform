import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { forgotPasswordAction } from '../actions';

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth');
  return (
    <>
      <h1>{t('forgotTitle')}</h1>
      <ActionForm action={forgotPasswordAction}>
        <Field name="email" type="email" label={t('email')} autoComplete="email" required />
        <SubmitButton>{t('forgotSubmit')}</SubmitButton>
      </ActionForm>
      <p className="small">
        <Link href="/login">{t('loginTitle')}</Link>
      </p>
    </>
  );
}
