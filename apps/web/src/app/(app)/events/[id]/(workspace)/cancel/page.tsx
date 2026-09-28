import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm, SubmitButton, TextArea } from '@/components/forms';
import { Icon } from '@/components/icons';
import { loadEventView } from '@/lib/events';
import { transitionAction } from '../../../actions';

export const metadata: Metadata = { title: 'إلغاء المناسبة' };

export default async function CancelEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadEventView(id);
  if (!view.allowedActions.includes('cancel')) redirect(`/events/${id}`);
  const t = await getTranslations('cancelEvent');
  const tc = await getTranslations('common');
  const keeps = ['keeps1', 'keeps2', 'keeps3'] as const;
  return (
    <section className="settings-section cancel-page" aria-labelledby="cancel-h">
      <header>
        <h2 id="cancel-h">{t('title')}</h2>
        <p>{t('body')}</p>
      </header>
      <div className="panel danger-zone stack">
        <ul className="keeps">
          {keeps.map((k) => (
            <li key={k}>{t(k)}</li>
          ))}
        </ul>
        <ActionForm action={transitionAction.bind(null, id)}>
          <input type="hidden" name="action" value="cancel" />
          <input type="hidden" name="expectedStatus" value={view.event.status} />
          <TextArea
            name="reason"
            label={t('reason')}
            hint={t('reasonHint')}
            rows={3}
            maxLength={500}
            required
          />
          <div className="form-actions">
            <SubmitButton variant="danger-solid">
              <Icon name="ban" />
              {t('submit')}
            </SubmitButton>
            <Link href={`/events/${id}/settings`} className="btn btn-ghost">
              {tc('back')}
            </Link>
          </div>
        </ActionForm>
      </div>
    </section>
  );
}
