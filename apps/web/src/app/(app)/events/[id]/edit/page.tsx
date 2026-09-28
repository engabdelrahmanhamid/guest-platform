import { utcToLocal } from '@gp/core';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EventForm } from '@/components/event-form';
import { loadEventView } from '@/lib/events';
import { TIMEZONES } from '@/lib/format';
import { updateEventAction } from '../../actions';

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadEventView(id);
  if (!view.canEdit) redirect(`/events/${id}`);
  const e = view.event;
  const t = await getTranslations('eventForm');
  return (
    <>
      <h1>{t('editTitle')}</h1>
      <section className="card">
        <EventForm
          action={updateEventAction.bind(null, id)}
          timezones={TIMEZONES.includes(e.timezone) ? TIMEZONES : [e.timezone, ...TIMEZONES]}
          submitLabel={t('save')}
          values={{
            category: e.category,
            type: e.type,
            name: e.name,
            startsAt: utcToLocal(e.startsAt, e.timezone),
            endsAt: e.endsAt ? utcToLocal(e.endsAt, e.timezone) : '',
            timezone: e.timezone,
            city: e.city,
            venueName: e.venueName,
            address: e.address ?? '',
            mapsUrl: e.mapsUrl ?? '',
            description: e.description ?? '',
            defaultAllowedCompanions: e.defaultAllowedCompanions,
            autoOpenCheckin: e.autoOpenCheckin,
            checkinOpensOffsetMin: e.checkinOpensOffsetMin,
            assumedDurationMin: e.assumedDurationMin,
            autoCloseCheckin: e.autoCloseCheckin,
            checkinClosesOffsetMin: e.checkinClosesOffsetMin,
            reopenWindowMin: e.reopenWindowMin,
          }}
        />
      </section>
    </>
  );
}
