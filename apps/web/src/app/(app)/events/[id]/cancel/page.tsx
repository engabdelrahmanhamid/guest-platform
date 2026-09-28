import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { ActionForm, SubmitButton, TextArea } from '@/components/forms';
import { Icon } from '@/components/icons';
import { loadEventView } from '@/lib/events';
import { transitionAction } from '../../actions';

export const metadata: Metadata = { title: 'إلغاء المناسبة' };

export default async function CancelEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadEventView(id);
  if (!view.allowedActions.includes('cancel')) redirect(`/events/${id}`);
  const t = await getTranslations('cancelEvent');
  const tn = await getTranslations('nav');
  const tc = await getTranslations('common');
  const keeps = ['keeps1', 'keeps2', 'keeps3'] as const;
  return (
    <div style={{ maxInlineSize: 620, marginInline: 'auto' }}>
      <nav className="crumbs">
        <Link href="/dashboard">{tn('dashboard')}</Link>
        <Icon name="chevronBack" />
        <Link href={`/events/${id}`}>{view.event.name}</Link>
        <Icon name="chevronBack" />
        <span>{t('title')}</span>
      </nav>
      <section className="card danger-zone stack">
        <div className="page-head" style={{ marginBlockEnd: 0 }}>
          <div>
            <h1>{t('title')}</h1>
            <p className="lead">{view.event.name}</p>
          </div>
        </div>
        <div className="alert alert-warn">
          <Icon name="alert" />
          <div className="grow">
            <p>{t('body')}</p>
            <ul style={{ margin: '0.5rem 0 0', paddingInlineStart: '1.1rem' }}>
              {keeps.map((k) => (
                <li key={k}>{t(k)}</li>
              ))}
            </ul>
          </div>
        </div>
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
            <SubmitButton variant="danger-solid">{t('submit')}</SubmitButton>
            <Link href={`/events/${id}`} className="btn btn-ghost">
              {tc('back')}
            </Link>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
