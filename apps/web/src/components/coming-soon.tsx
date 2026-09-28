import { getTranslations } from 'next-intl/server';
import type { WorkspaceArea } from '@/lib/events';
import { Icon, type IconName } from './icons';

/**
 * A workspace area that ships in a later phase. States what the area will do, with no sample
 * data, and stays visually quieter than working areas.
 */
export async function ComingSoon({
  area,
  icon,
}: {
  area: Exclude<WorkspaceArea, 'overview' | 'settings'>;
  icon: IconName;
}) {
  const t = await getTranslations('comingSoon');
  const tw = await getTranslations('workspace');
  const points = ['p1', 'p2', 'p3'] as const;
  return (
    <section className="soon" aria-labelledby="soon-h">
      <span className="glyph">
        <Icon name={icon} />
      </span>
      <div className="body">
        <div className="title-row">
          <h2 id="soon-h">{tw(`areas.${area}`)}</h2>
          <span className="tag">{tw('soon')}</span>
        </div>
        <p>{t(`${area}.lead`)}</p>
        <ul>
          {points.map((p) => (
            <li key={p}>{t(`${area}.${p}`)}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
