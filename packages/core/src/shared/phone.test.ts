import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone';

describe('normalizePhone', () => {
  it.each(['0551234567', '551234567', '+966551234567', '00966551234567', '055 123 4567'])(
    'normalizes Saudi format %s',
    (input) => expect(normalizePhone(input)).toBe('+966551234567'),
  );

  it('accepts international numbers', () => {
    expect(normalizePhone('+971501234567')).toBe('+971501234567');
  });

  it('rejects invalid numbers', () => {
    expect(normalizePhone('12345')).toBeNull();
  });
});
