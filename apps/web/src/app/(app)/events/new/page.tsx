import { EVENT_TYPES_BY_CATEGORY, type EventCategory } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { EVENT_TYPE_ICONS, Icon } from '@/components/icons';
import { CreateStepper } from '@/components/stepper';

export const metadata: Metadata = { title: 'مناسبة جديدة' };

export default async function ChooseEventTypePage() {
  const t = await getTranslations();
  return (
    <div className="card" style={{ maxInlineSize: 820, marginInline: 'auto' }}>
      <CreateStepper current={1} />
      <div className="page-head">
        <div>
          <h1>{t('eventForm.chooseTitle')}</h1>
          <p className="lead">{t('eventForm.chooseSubtitle')}</p>
        </div>
      </div>
      {(Object.keys(EVENT_TYPES_BY_CATEGORY) as EventCategory[]).map((category) => (
        <section key={category} className="category-block">
          <header>
            <h2>{t(`category.${category}`)}</h2>
            <p>{t(`categoryHint.${category}`)}</p>
          </header>
          <div className="choice-grid">
            {EVENT_TYPES_BY_CATEGORY[category].map((type) => (
              <Link
                key={type}
                href={`/events/new/details?category=${category}&type=${type}`}
                className="choice"
              >
                <span className="glyph">
                  <Icon name={EVENT_TYPE_ICONS[type] ?? 'sparkle'} />
                </span>
                {t(`eventType.${type}`)}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
