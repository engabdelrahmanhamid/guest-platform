import { describe, expect, it } from 'vitest';
import { isDomainError } from '../shared/errors';
import { parseSettingValue } from './settings';

describe('platform setting validation', () => {
  it('accepts values within range and null where allowed', () => {
    expect(parseSettingValue('lifecycle.checkin_opens_offset_min', -120)).toBe(-120);
    expect(parseSettingValue('retention.guest_pii_days', null)).toBeNull();
    expect(parseSettingValue('auto_archive.days', null)).toBeNull();
  });

  it('rejects out-of-range and wrongly typed values', () => {
    for (const [key, value] of [
      ['lifecycle.checkin_opens_offset_min', 30],
      ['lifecycle.assumed_duration_min', 10],
      ['lifecycle.auto_open_checkin', 'yes'],
      ['retention.guest_pii_days', 0],
    ] as const) {
      try {
        parseSettingValue(key, value);
        expect.unreachable();
      } catch (err) {
        expect(isDomainError(err, 'validation_failed')).toBe(true);
      }
    }
  });
});
