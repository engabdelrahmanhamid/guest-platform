import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { loginAction } from '../actions';

export default async function LoginPage() {
  const t = await getTranslations('auth');
  return (
    <>
      <h1>{t('loginTitle')}</h1>
      <ActionForm action={loginAction}>
        <Field name="email" type="email" label={t('email')} autoComplete="email" required />
        <Field
          name="password"
          type="password"
          label={t('password')}
          autoComplete="current-password"
          required
        />
        <SubmitButton>{t('loginSubmit')}</SubmitButton>
      </ActionForm>
      <p className="small">
        <Link href="/forgot-password">{t('forgot')}</Link>
      </p>
      <p className="small">
        {t('noAccount')} <Link href="/signup">{t('signupTitle')}</Link>
      </p>
    </>
  );
}
