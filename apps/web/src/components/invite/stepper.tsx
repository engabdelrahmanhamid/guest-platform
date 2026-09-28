'use client';

import { useState } from 'react';

/**
 * Companion count: a plain number field that works without JavaScript, with − and + buttons
 * once the script loads. The server checks the range again.
 */
export function CompanionStepper({
  name,
  label,
  hint,
  max,
  initial,
  fewer,
  more,
  disabled,
}: {
  name: string;
  label: string;
  hint: string;
  max: number;
  initial: number;
  fewer: string;
  more: string;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(Math.min(Math.max(initial, 0), max));
  const id = `${name}-field`;
  const set = (n: number) => setValue(Math.min(Math.max(n, 0), max));
  return (
    <div className="inv-stepper">
      <label htmlFor={id}>{label}</label>
      <div className="inv-stepper-row">
        <button
          type="button"
          className="inv-step"
          aria-label={fewer}
          aria-controls={id}
          disabled={disabled || value <= 0}
          onClick={() => set(value - 1)}
        >
          −
        </button>
        <input
          id={id}
          name={name}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          step={1}
          value={value}
          disabled={disabled}
          aria-describedby={`${id}-hint`}
          onChange={(e) => set(Number(e.target.value) || 0)}
        />
        <button
          type="button"
          className="inv-step"
          aria-label={more}
          aria-controls={id}
          disabled={disabled || value >= max}
          onClick={() => set(value + 1)}
        >
          +
        </button>
      </div>
      <p id={`${id}-hint`} className="inv-hint">
        {hint}
      </p>
    </div>
  );
}
