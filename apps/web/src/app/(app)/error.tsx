'use client';

import { useTranslations } from 'next-intl';

export default function AppError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('statusPage');
  return (
    <div className="status-page">
      <div className="stack" style={{ justifyItems: 'center' }}>
        <h1>{t('errorTitle')}</h1>
        <p className="muted">{t('errorBody')}</p>
        <button type="button" className="btn btn-primary" onClick={reset}>
          {t('retry')}
        </button>
      </div>
    </div>
  );
}
