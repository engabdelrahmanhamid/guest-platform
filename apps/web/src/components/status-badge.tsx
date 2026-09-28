import { getTranslations } from 'next-intl/server';

/** The one status marker for events, used on cards, the event header and admin tables. */
export async function StatusBadge({
  status,
  disabled,
  size,
}: {
  status: string;
  disabled?: boolean;
  size?: 'lg';
}) {
  const t = await getTranslations('status');
  const cls = size ? ' status-lg' : '';
  return (
    <span className="row-tight">
      <span className={`status status-${status}${cls}`}>{t(status)}</span>
      {disabled && <span className={`status status-disabled${cls}`}>{t('disabled')}</span>}
    </span>
  );
}
