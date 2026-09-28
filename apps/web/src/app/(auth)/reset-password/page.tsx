import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { ActionForm, Field, SubmitButton } from '@/components/forms';
import { resetPasswordAction } from '../actions';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = '' } = await searchParams;
  const t = await getTranslations('auth');
  return (
    <>
      <h1>{t('resetTitle')}</h1>
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
        <SubmitButton>{t('resetSubmit')}</SubmitButton>
      </ActionForm>
      <p className="small">
        <Link href="/login">{t('loginTitle')}</Link>
      </p>
    </>
  );
}
