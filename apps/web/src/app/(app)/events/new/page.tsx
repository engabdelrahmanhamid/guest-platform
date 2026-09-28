import { EVENT_TYPES_BY_CATEGORY, type EventCategory } from '@gp/core';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function ChooseEventTypePage() {
  const t = await getTranslations();
  return (
    <>
      <h1>{t('eventForm.chooseTitle')}</h1>
      <p className="muted">{t('eventForm.chooseSubtitle')}</p>
      {(Object.keys(EVENT_TYPES_BY_CATEGORY) as EventCategory[]).map((category) => (
        <section key={category} className="card">
          <h2>{t(`category.${category}`)}</h2>
          <div className="choice-grid">
            {EVENT_TYPES_BY_CATEGORY[category].map((type) => (
              <Link
                key={type}
                href={`/events/new/details?category=${category}&type=${type}`}
                className="choice"
              >
                {t(`eventType.${type}`)}
              </Link>
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
