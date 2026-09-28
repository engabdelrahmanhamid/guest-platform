import type { ReactNode } from 'react';
import { Icon, type IconName } from './icons';

/** Short explanation plus the next action where one exists. */
export function EmptyState({
  icon,
  title,
  body,
  action,
  compact,
  headingLevel = 2,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: ReactNode;
  compact?: boolean;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <div className={`empty${compact ? ' empty-compact' : ''}`}>
      {!compact && (
        <span className="glyph">
          <Icon name={icon} />
        </span>
      )}
      <Heading>{title}</Heading>
      {body && <p>{body}</p>}
      {action && <div className="actions">{action}</div>}
    </div>
  );
}
