import { getTranslations } from 'next-intl/server';
import { Icon } from '../icons';

const STEPS = ['upload', 'review', 'done'] as const;

/** Upload → review → import. */
export async function ImportSteps({ current }: { current: (typeof STEPS)[number] }) {
  const t = await getTranslations('guests.import.steps');
  const at = STEPS.indexOf(current);
  return (
    <ol className="import-steps">
      {STEPS.map((s, i) => (
        <li
          key={s}
          data-state={i < at ? 'done' : i === at ? 'current' : 'todo'}
          aria-current={i === at ? 'step' : undefined}
        >
          <span className="n">{i < at ? <Icon name="check" /> : i + 1}</span>
          {t(s)}
        </li>
      ))}
    </ol>
  );
}
