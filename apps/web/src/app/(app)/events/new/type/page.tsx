import { EVENT_TYPES_BY_CATEGORY, type EventCategory } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { EVENT_TYPE_ICONS, Icon } from '@/components/icons';
import { CreateStepper } from '@/components/stepper';

export const metadata: Metadata = { title: 'نوع المناسبة' };

/** Create, step 1b: the event type within the chosen category. */
export default async function ChooseTypePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
  const { category } = await searchParams;
  const types = EVENT_TYPES_BY_CATEGORY[category as EventCategory] as readonly string[] | undefined;
  if (!types) redirect('/events/new');
  const t = await getTranslations();
  return (
    <div className="wizard">
      <CreateStepper current={1} />
      <div className="page-head">
        <div className="titles">
          <Link href="/events/new" className="back-link">
            <Icon name="chevronBack" />
            {t('eventForm.backToCategory')}
          </Link>
          <h1>{t('eventForm.typeTitle')}</h1>
          <p className="lead">{t(`categoryHint.${category}`)}</p>
        </div>
        <span className="chosen">
          {t(`category.${category}`)}
          <Link href="/events/new">{t('eventForm.change')}</Link>
        </span>
      </div>
      <ul className="type-grid" role="list">
        {types.map((type) => (
          <li key={type}>
            <Link
              href={`/events/new/details?category=${category}&type=${type}`}
              className="type-choice"
            >
              <span className="glyph">
                <Icon name={EVENT_TYPE_ICONS[type] ?? 'sparkle'} />
              </span>
              {t(`eventType.${type}`)}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
