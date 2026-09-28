import { getTranslations } from 'next-intl/server';

export async function StatusBadge({ status, disabled }: { status: string; disabled?: boolean }) {
  const t = await getTranslations('status');
  return (
    <span className="row" style={{ gap: '0.35rem' }}>
      <span className={`badge badge-${status}`}>{t(status)}</span>
      {disabled && <span className="badge badge-disabled">{t('disabled')}</span>}
    </span>
  );
}
