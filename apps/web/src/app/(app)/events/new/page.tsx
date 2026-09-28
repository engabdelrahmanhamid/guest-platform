import { EVENT_TYPES_BY_CATEGORY, type EventCategory } from '@gp/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Icon, type IconName } from '@/components/icons';
import { CreateStepper } from '@/components/stepper';

export const metadata: Metadata = { title: 'مناسبة جديدة' };

const CATEGORY_ICON: Record<EventCategory, IconName> = { private: 'home', business: 'building' };

/** Create, step 1a: private or business. */
export default async function ChooseCategoryPage() {
  const t = await getTranslations();
  return (
    <div className="wizard">
      <CreateStepper current={1} />
      <div className="page-head">
        <div className="titles">
          <h1>{t('eventForm.categoryTitle')}</h1>
          <p className="lead">{t('eventForm.categorySubtitle')}</p>
        </div>
      </div>
      <ul className="category-choices" role="list">
        {(Object.keys(EVENT_TYPES_BY_CATEGORY) as EventCategory[]).map((category) => (
          <li key={category}>
            <Link href={`/events/new/type?category=${category}`} className="category-choice">
              <span className="glyph">
                <Icon name={CATEGORY_ICON[category]} />
              </span>
              <h2>{t(`category.${category}`)}</h2>
              <p>{t(`categoryHint.${category}`)}</p>
              <span className="go" aria-hidden="true">
                {t('eventForm.choose')}
                <Icon name="arrow" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
