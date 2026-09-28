import { utcToLocal } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EventForm } from '@/components/event-form';
import { Icon } from '@/components/icons';
import { loadEventView } from '@/lib/events';
import { TIMEZONES } from '@/lib/format';
import { updateEventAction } from '../../actions';

export const metadata: Metadata = { title: 'تعديل المناسبة' };

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { view } = await loadEventView(id);
  if (!view.canEdit) redirect(`/events/${id}`);
  const e = view.event;
  const t = await getTranslations('eventForm');
  const tn = await getTranslations('nav');
  return (
    <div style={{ maxInlineSize: 820, marginInline: 'auto' }}>
      <nav className="crumbs">
        <Link href="/dashboard">{tn('dashboard')}</Link>
        <Icon name="chevronBack" />
        <Link href={`/events/${id}`}>{e.name}</Link>
        <Icon name="chevronBack" />
        <span>{t('editTitle')}</span>
      </nav>
      <section className="card">
        <div className="page-head">
          <h1>{t('editTitle')}</h1>
        </div>
        <EventForm
          action={updateEventAction.bind(null, id)}
          cancelHref={`/events/${id}`}
          timezones={
            TIMEZONES.some((z) => z.value === e.timezone)
              ? TIMEZONES
              : [{ value: e.timezone, label: e.timezone }, ...TIMEZONES]
          }
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
    </div>
  );
}
