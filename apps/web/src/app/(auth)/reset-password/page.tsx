import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { resetPasswordAction } from '../actions';

export const metadata: Metadata = { title: 'كلمة مرور جديدة' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  const t = await getTranslations('auth');
  return (
    <>
      <header>
        <h1>{t('resetTitle')}</h1>
        <p>{t('resetSubtitle')}</p>
      </header>
      <ActionForm action={resetPasswordAction}>
        <input type="hidden" name="token" value={token} />
        <Field
          name="password"
          type="password"
          label={t('newPassword')}
          hint={t('passwordHint')}
          autoComplete="new-password"
          required
        />
        <SubmitButton block>{t('resetSubmit')}</SubmitButton>
      </ActionForm>
      <p className="alt">
        <Link href="/login">{t('backToLogin')}</Link>
      </p>
    </>
  );
}
