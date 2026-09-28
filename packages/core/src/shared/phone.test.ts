import { describe, expect, it } from 'vitest';
import { normalizePhone, parsePhone, phoneSearchDigits } from './phone';
import { searchForm } from './text';

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

describe('parsePhone', () => {
  it.each([
    '0551234567',
    '551234567',
    '+966551234567',
    '00966551234567',
    '966551234567',
    '٠٥٥١٢٣٤٥٦٧',
    '055-123-4567',
  ])('reads Saudi form %s as +966551234567', (input) =>
    expect(parsePhone(input)).toEqual({ ok: true, e164: '+966551234567' }),
  );

  it.each([
    ['+971501234567', '+971501234567'],
    ['+44 7911 123456', '+447911123456'],
    ['001 202 555 0143', '+12025550143'],
  ])('accepts international %s', (input, e164) =>
    expect(parsePhone(input)).toEqual({ ok: true, e164 }),
  );

  it.each([
    ['', 'missing_phone'],
    ['   ', 'missing_phone'],
    ['12345', 'invalid_phone'],
    ['055123456', 'invalid_phone'],
    ['0551234567 / 0501234567', 'unsupported_phone'],
    ['9.66551E+11', 'unsupported_phone'],
    ['call me', 'unsupported_phone'],
    ['05512+34567', 'unsupported_phone'],
  ])('names the problem with %j', (input, problem) =>
    expect(parsePhone(input)).toEqual({ ok: false, problem }),
  );

  it('finds the digits to search for', () => {
    expect(phoneSearchDigits('0551')).toBe('551');
    expect(phoneSearchDigits('00966 55')).toBe('96655');
    expect(phoneSearchDigits('05')).toBeNull();
    expect(phoneSearchDigits('أحمد')).toBeNull();
  });
});

describe('searchForm', () => {
  it.each([
    ['أحمد إبراهيم', 'احمد ابراهيم'],
    ['آمنة', 'امنه'],
    ['مُحَمَّد', 'محمد'],
    ['مصطفى', 'مصطفي'],
    ['عبـــدالله', 'عبدالله'],
    ['  JOSÉ   Smith ', 'jose smith'],
  ])('%s → %s', (input, out) => expect(searchForm(input)).toBe(out));
});
