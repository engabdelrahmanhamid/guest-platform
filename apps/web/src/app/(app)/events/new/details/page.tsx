import { EVENT_TYPES_BY_CATEGORY, type EventCategory, getLifecycleDefaults } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EventForm } from '@/components/event-form';
import { EVENT_TYPE_ICONS, Icon } from '@/components/icons';
import { CreateStepper } from '@/components/stepper';
import { TIMEZONES } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { createEventAction } from '../../actions';

export const metadata: Metadata = { title: 'تفاصيل المناسبة' };

export default async function NewEventDetailsPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; type?: string }>;
}) {
  const { category, type } = await searchParams;
  const types = EVENT_TYPES_BY_CATEGORY[category as EventCategory] as readonly string[] | undefined;
  if (!types || !type || !types.includes(type)) redirect('/events/new');

  const t = await getTranslations();
  const defaults = await getLifecycleDefaults(getCoreContext().db);
  return (
    <div className="wizard">
      <CreateStepper current={2} />
      <div className="page-head">
        <div className="titles">
          <Link href={`/events/new/type?category=${category}`} className="back-link">
            <Icon name="chevronBack" />
            {t('eventForm.backToType')}
          </Link>
          <h1>{t('eventForm.detailsTitle')}</h1>
          <p className="lead">{t('eventForm.detailsSubtitle')}</p>
        </div>
        <span className="chosen">
          <Icon name={EVENT_TYPE_ICONS[type] ?? 'sparkle'} />
          {t(`category.${category}`)} · {t(`eventType.${type}`)}
          <Link href={`/events/new/type?category=${category}`}>{t('eventForm.change')}</Link>
        </span>
      </div>
      <div className="panel">
        <EventForm
          action={createEventAction}
          timezones={TIMEZONES}
          cancelHref="/dashboard"
          submitLabel={t('eventForm.create')}
          values={{
            category: category!,
            type,
            timezone: 'Asia/Riyadh',
            defaultAllowedCompanions: 0,
            ...defaults,
          }}
        />
      </div>
    </div>
  );
}
