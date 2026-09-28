import { platformSettings } from '@gp/db/schema';
import { z } from 'zod';
import { DomainError } from '../shared/errors';
import type { DbOrTx } from '../shared/context';

/** Every platform setting, with the shape its value must have. */
export const SETTING_SCHEMAS = {
  'lifecycle.auto_open_checkin': z.boolean(),
  'lifecycle.checkin_opens_offset_min': z.number().int().min(-10080).max(0),
  'lifecycle.assumed_duration_min': z.number().int().min(30).max(4320),
  'lifecycle.auto_close_checkin': z.boolean(),
  'lifecycle.checkin_closes_offset_min': z.number().int().min(0).max(4320),
  'lifecycle.reopen_window_min': z.number().int().min(0).max(10080),
  /** Days after completion or cancellation before auto-archive; null disables it. */
  'auto_archive.days': z.number().int().min(1).max(3650).nullable(),
  /** Guest personal-data retention in days; null (the default) means no anonymization. */
  'retention.guest_pii_days': z.number().int().min(1).max(3650).nullable(),
} as const;

export type SettingKey = keyof typeof SETTING_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTING_SCHEMAS)[K]>;

export function isSettingKey(key: string): key is SettingKey {
  return key in SETTING_SCHEMAS;
}

export function parseSettingValue<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  const result = SETTING_SCHEMAS[key].safeParse(value);
  if (!result.success) {
    throw new DomainError('validation_failed', `Invalid value for ${key}`, {
      fields: { value: result.error.issues[0]?.message ?? 'invalid' },
    });
  }
  return result.data as SettingValue<K>;
}

export async function getAllSettings(db: DbOrTx): Promise<{ [K in SettingKey]: SettingValue<K> }> {
  const rows = await db.select().from(platformSettings);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SETTING_SCHEMAS) as SettingKey[]) {
    if (!byKey.has(key)) throw new Error(`Missing platform setting ${key}; run migrations`);
    out[key] = parseSettingValue(key, byKey.get(key));
  }
  return out as { [K in SettingKey]: SettingValue<K> };
}

export interface LifecycleDefaults {
  autoOpenCheckin: boolean;
  checkinOpensOffsetMin: number;
  assumedDurationMin: number;
  autoCloseCheckin: boolean;
  checkinClosesOffsetMin: number;
  reopenWindowMin: number;
}

export async function getLifecycleDefaults(db: DbOrTx): Promise<LifecycleDefaults> {
  const s = await getAllSettings(db);
  return {
    autoOpenCheckin: s['lifecycle.auto_open_checkin'],
    checkinOpensOffsetMin: s['lifecycle.checkin_opens_offset_min'],
    assumedDurationMin: s['lifecycle.assumed_duration_min'],
    autoCloseCheckin: s['lifecycle.auto_close_checkin'],
    checkinClosesOffsetMin: s['lifecycle.checkin_closes_offset_min'],
    reopenWindowMin: s['lifecycle.reopen_window_min'],
  };
}
