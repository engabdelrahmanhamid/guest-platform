import { EVENT_TYPES_BY_CATEGORY, type EventCategory, getLifecycleDefaults } from '@gp/core';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EventForm } from '@/components/event-form';
import { TIMEZONES } from '@/lib/format';
import { getCoreContext } from '@/lib/server';
import { createEventAction } from '../../actions';

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
    <>
      <h1>{t('eventForm.detailsTitle')}</h1>
      <p className="muted">
        {t(`category.${category}`)} · {t(`eventType.${type}`)}
      </p>
      <section className="card">
        <EventForm
          action={createEventAction}
          timezones={TIMEZONES}
          submitLabel={t('eventForm.create')}
          values={{
            category: category!,
            type,
            timezone: 'Asia/Riyadh',
            defaultAllowedCompanions: 0,
            ...defaults,
          }}
        />
      </section>
    </>
  );
}
