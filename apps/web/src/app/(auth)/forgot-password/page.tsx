import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { forgotPasswordAction } from '../actions';

export const metadata: Metadata = { title: 'استعادة كلمة المرور' };

export default async function ForgotPasswordPage() {
  const t = await getTranslations('auth');
  return (
    <>
      <header>
        <h1>{t('forgotTitle')}</h1>
        <p>{t('forgotSubtitle')}</p>
      </header>
      <ActionForm action={forgotPasswordAction}>
        <Field name="email" type="email" label={t('email')} autoComplete="email" required />
        <SubmitButton block>{t('forgotSubmit')}</SubmitButton>
      </ActionForm>
      <p className="alt">
        <Link href="/login">{t('backToLogin')}</Link>
      </p>
    </>
  );
}
