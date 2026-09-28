import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import type { EventSummary } from '@/lib/event-list';
import { dateTile, formatDayMonth, formatTime } from '@/lib/format';
import { EVENT_TYPE_ICONS, Icon } from './icons';
import { StatusBadge } from './status-badge';

/** Forward steps an owner takes next, by status. Finished events have none. */
const NEXT: Record<string, string> = { draft: 'activate', active: 'start', live: 'complete' };

/** An event in a list. The whole card opens the event through its title link. */
export async function EventCard({ event: e }: { event: EventSummary }) {
  const t = await getTranslations();
  const tile = dateTile(e.startsAt, e.timezone);
  const past = ['completed', 'cancelled', 'archived'].includes(e.status);
  const next = e.disabledAt ? undefined : NEXT[e.status];
  return (
    <article className={`event-card${past ? ' is-past' : ''}`}>
      <span className="date-tile" aria-hidden="true">
        <span className="m">{tile.month}</span>
        <span className="d">{tile.day}</span>
      </span>
      <div className="body">
        <h3 className="t-card">
          <Link href={`/events/${e.id}`}>{e.name}</Link>
        </h3>
        <p className="meta">
          <span>
            <Icon name={EVENT_TYPE_ICONS[e.type] ?? 'sparkle'} />
            {t(`eventType.${e.type}`)}
          </span>
          <span>
            <Icon name="calendar" />
            {formatDayMonth(e.startsAt, e.timezone)} · {formatTime(e.startsAt, e.timezone)}
          </span>
          <span>
            <Icon name="pin" />
            {e.city} · {e.venueName}
          </span>
        </p>
      </div>
      <div className="foot">
        <StatusBadge status={e.status} disabled={e.disabledAt !== null} />
        {next && (
          <span className="next">
            {t(`eventCard.next.${next}`)}
            <Icon name="arrow" />
          </span>
        )}
      </div>
    </article>
  );
}
