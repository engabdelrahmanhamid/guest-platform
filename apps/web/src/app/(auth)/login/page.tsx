import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { loginAction } from '../actions';

export const metadata: Metadata = { title: 'تسجيل الدخول' };

export default async function LoginPage() {
  const t = await getTranslations('auth');
  return (
    <>
      <header>
        <h1>{t('loginTitle')}</h1>
        <p>{t('loginSubtitle')}</p>
      </header>
      <ActionForm action={loginAction}>
        <Field name="email" type="email" label={t('email')} autoComplete="email" required />
        <Field
          name="password"
          type="password"
          label={t('password')}
          autoComplete="current-password"
          aside={<Link href="/forgot-password">{t('forgot')}</Link>}
          required
        />
        <SubmitButton block>{t('loginSubmit')}</SubmitButton>
      </ActionForm>
      <p className="alt">
        {t('noAccount')} <Link href="/signup">{t('signupTitle')}</Link>
      </p>
    </>
  );
}
