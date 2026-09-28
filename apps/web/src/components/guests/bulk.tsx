'use client';

import { useTranslations } from 'next-intl';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonClass } from '../button';
import { ConfirmSubmit } from '../confirm-submit';
import { type FormState, ActionForm } from '../forms';
import { Icon } from '../icons';

/**
 * The guest list is one form: each row has a checkbox named "ids", and the bar that appears
 * once something is selected submits the chosen action for those guests. Selection covers the
 * page being shown.
 */
export function BulkForm({
  action,
  returnTo,
  groups,
  children,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  returnTo: string;
  groups: { id: string; name: string }[];
  children: ReactNode;
}) {
  return (
    <ActionForm action={action} className="bulk-form" id="bulk">
      <input type="hidden" name="returnTo" value={returnTo} />
      <Selection groups={groups}>{children}</Selection>
    </ActionForm>
  );
}

function Selection({
  groups,
  children,
}: {
  groups: { id: string; name: string }[];
  children: ReactNode;
}) {
  const t = useTranslations('guests.bulk');
  const ref = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(0);
  const [op, setOp] = useState<'group' | 'companions' | 'cancel' | null>(null);
  const { pending } = useFormStatus();

  const recount = useCallback(() => {
    const boxes = [...(ref.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]') ?? [])];
    const n = boxes.filter((b) => b.checked).length;
    setCount(n);
    const all = ref.current?.querySelector<HTMLInputElement>('input[data-select-all]');
    if (all) {
      all.checked = n > 0 && n === boxes.length;
      all.indeterminate = n > 0 && n < boxes.length;
    }
  }, []);

  useEffect(recount, [recount, children]);

  const onChange = (e: React.ChangeEvent<HTMLDivElement>) => {
    const target = e.target as unknown as HTMLInputElement;
    if (target.dataset.selectAll !== undefined) {
      for (const b of ref.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]') ?? []) {
        b.checked = target.checked;
      }
    }
    if (target.name === 'ids' || target.dataset.selectAll !== undefined) recount();
  };

  const clear = () => {
    for (const b of ref.current?.querySelectorAll<HTMLInputElement>('input[name="ids"]') ?? [])
      b.checked = false;
    setOp(null);
    recount();
  };

  return (
    <div ref={ref} onChange={onChange}>
      {children}
      {count > 0 && (
        <div className="bulk-bar" role="region" aria-label={t('label')}>
          <span className="bulk-count">
            <strong>{t('selected', { count })}</strong>
            <button type="button" className={buttonClass('link', 'sm')} onClick={clear}>
              {t('clear')}
            </button>
          </span>
          {op === null && (
            <span className="bulk-ops">
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => setOp('group')}
              >
                <Icon name="tag" />
                {t('assignGroup')}
              </button>
              <button
                type="button"
                className={buttonClass('secondary', 'sm')}
                onClick={() => setOp('companions')}
              >
                <Icon name="users" />
                {t('companions')}
              </button>
              <button
                type="button"
                className={buttonClass('danger', 'sm')}
                onClick={() => setOp('cancel')}
              >
                <Icon name="ban" />
                {t('cancel')}
              </button>
            </span>
          )}
          {op === 'group' && (
            <span className="bulk-ops">
              <label className="sr-only" htmlFor="bulkGroup">
                {t('assignGroup')}
              </label>
              <select id="bulkGroup" name="bulkGroup" defaultValue="" className="select-sm">
                <option value="none">{t('noGroup')}</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                name="op"
                value="group"
                className={buttonClass('primary', 'sm')}
                disabled={pending}
              >
                {t('apply', { count })}
              </button>
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                onClick={() => setOp(null)}
              >
                {t('back')}
              </button>
            </span>
          )}
          {op === 'companions' && (
            <span className="bulk-ops">
              <label className="sr-only" htmlFor="bulkCompanions">
                {t('companions')}
              </label>
              <input
                id="bulkCompanions"
                name="bulkCompanions"
                type="number"
                min={0}
                max={20}
                defaultValue={0}
                className="input-sm"
                inputMode="numeric"
              />
              <button
                type="submit"
                name="op"
                value="companions"
                className={buttonClass('primary', 'sm')}
                disabled={pending}
              >
                {t('apply', { count })}
              </button>
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                onClick={() => setOp(null)}
              >
                {t('back')}
              </button>
            </span>
          )}
          {op === 'cancel' && (
            <span className="bulk-ops">
              <label className="sr-only" htmlFor="bulkReason">
                {t('reason')}
              </label>
              <input
                id="bulkReason"
                name="bulkReason"
                maxLength={300}
                placeholder={t('reason')}
                className="input-sm"
              />
              <ConfirmSubmit
                name="op"
                value="cancel"
                variant="danger"
                size="sm"
                confirm={t('confirmCancel', { count })}
                confirmLabel={t('cancelN', { count })}
              >
                {t('cancelN', { count })}
              </ConfirmSubmit>
              <button
                type="button"
                className={buttonClass('ghost', 'sm')}
                onClick={() => setOp(null)}
              >
                {t('back')}
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
