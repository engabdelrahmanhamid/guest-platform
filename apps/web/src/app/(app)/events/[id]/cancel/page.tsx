import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm, SubmitButton, TextArea } from '@/components/forms';
import { loadEventView } from '@/lib/events';
import { transitionAction } from '../../actions';

export default async function CancelEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadEventView(id);
  if (!view.allowedActions.includes('cancel')) redirect(`/events/${id}`);
  const t = await getTranslations('cancelEvent');
  return (
    <>
      <h1>{t('title')}</h1>
      <section className="card">
        <p>
          <strong>{view.event.name}</strong>
        </p>
        <p className="muted">{t('body')}</p>
        <ActionForm action={transitionAction.bind(null, id)}>
          <input type="hidden" name="action" value="cancel" />
          <input type="hidden" name="expectedStatus" value={view.event.status} />
          <TextArea name="reason" label={t('reason')} rows={3} maxLength={500} required />
          <div>
            <SubmitButton variant="danger">{t('submit')}</SubmitButton>
          </div>
        </ActionForm>
      </section>
    </>
  );
}
