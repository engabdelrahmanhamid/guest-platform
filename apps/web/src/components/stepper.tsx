import { getTranslations } from 'next-intl/server';
import { Icon } from './icons';

/** Create-event progress: 1 event type, 2 details, 3 review. */
export async function CreateStepper({ current }: { current: 1 | 2 | 3 }) {
  const t = await getTranslations('eventForm');
  const steps = [t('step1'), t('step2'), t('step3')];
  return (
    <ol className="stepper" aria-label={t('stepsLabel')}>
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'current' : 'todo';
        return (
          <li
            key={label}
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="n">{state === 'done' ? <Icon name="check" /> : n}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
