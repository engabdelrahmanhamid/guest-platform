import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { signUpAction } from '../actions';

export default async function SignUpPage() {
  const t = await getTranslations('auth');
  return (
    <>
      <h1>{t('signupTitle')}</h1>
      <ActionForm action={signUpAction}>
        <Field name="fullName" label={t('fullName')} autoComplete="name" required />
        <Field name="email" type="email" label={t('email')} autoComplete="email" required />
        <Field
          name="password"
          type="password"
          label={t('password')}
          hint={t('passwordHint')}
          autoComplete="new-password"
          required
        />
        <SubmitButton>{t('signupSubmit')}</SubmitButton>
      </ActionForm>
      <p className="small">
        {t('haveAccount')} <Link href="/login">{t('loginTitle')}</Link>
      </p>
    </>
  );
}
