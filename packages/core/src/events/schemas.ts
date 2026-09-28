import { TZDate } from '@date-fns/tz';
import { z } from 'zod';
import { SETTING_SCHEMAS } from '../settings/settings';

export const EVENT_TYPES_BY_CATEGORY = {
  private: ['wedding', 'malka', 'engagement', 'graduation', 'birthday', 'private_dinner', 'other'],
  business: [
    'conference',
    'corporate',
    'product_launch',
    'opening',
    'ceremony',
    'exhibition',
    'other',
  ],
} as const;
export type EventCategory = keyof typeof EVENT_TYPES_BY_CATEGORY;
export type EventType = (typeof EVENT_TYPES_BY_CATEGORY)[EventCategory][number];
const ALL_TYPES = [
  ...new Set([...EVENT_TYPES_BY_CATEGORY.private, ...EVENT_TYPES_BY_CATEGORY.business]),
] as [EventType, ...EventType[]];

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const LOCAL_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** Converts a wall-clock time ("2026-11-20T19:30", as an HTML datetime-local sends) in `tz` to UTC. */
export function localToUtc(local: string, tz: string): Date {
  const m = LOCAL_DATETIME.exec(local);
  if (!m) throw new Error('invalid local datetime');
  const [, y, mo, d, h, mi] = m.map(Number) as [number, number, number, number, number, number];
  return new Date(new TZDate(y, mo - 1, d, h, mi, tz).getTime());
}

/** The inverse of `localToUtc`, for pre-filling forms. */
export function utcToLocal(date: Date, tz: string): string {
  const z = new TZDate(date.getTime(), tz);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${z.getFullYear()}-${p(z.getMonth() + 1)}-${p(z.getDate())}T${p(z.getHours())}:${p(z.getMinutes())}`;
}

/** Form fields arrive as strings; blank means "not provided". */
const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optionalText = (max: number) =>
  z.preprocess(blankToUndefined, z.string().trim().max(max, { message: 'too_long' }).optional());
const requiredText = (max: number) =>
  z
    .string({ message: 'required' })
    .trim()
    .min(1, { message: 'required' })
    .max(max, { message: 'too_long' });
const localDateTime = z
  .string({ message: 'required' })
  .regex(LOCAL_DATETIME, { message: 'invalid_datetime' });
const formBoolean = z.preprocess(
  (v) => (v === 'on' || v === 'true' ? true : v === 'false' || v === 'off' ? false : v),
  z.boolean(),
);
const formInt = <T extends z.ZodNumber>(schema: T) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v), schema);

/** Per-event lifecycle overrides; anything left out keeps the platform default. */
export const lifecycleOverridesSchema = z
  .object({
    autoOpenCheckin: formBoolean,
    checkinOpensOffsetMin: formInt(SETTING_SCHEMAS['lifecycle.checkin_opens_offset_min']),
    assumedDurationMin: formInt(SETTING_SCHEMAS['lifecycle.assumed_duration_min']),
    autoCloseCheckin: formBoolean,
    checkinClosesOffsetMin: formInt(SETTING_SCHEMAS['lifecycle.checkin_closes_offset_min']),
    reopenWindowMin: formInt(SETTING_SCHEMAS['lifecycle.reopen_window_min']),
  })
  .partial();

export const eventDetailsSchema = z
  .object({
    category: z.enum(['private', 'business'], { message: 'required' }),
    type: z.enum(ALL_TYPES, { message: 'required' }),
    name: requiredText(150),
    startsAt: localDateTime,
    endsAt: z.preprocess(blankToUndefined, localDateTime.optional()),
    timezone: z
      .string()
      .default('Asia/Riyadh')
      .refine(isValidTimezone, { message: 'invalid_timezone' }),
    city: requiredText(80),
    venueName: requiredText(150),
    address: optionalText(300),
    mapsUrl: z.preprocess(
      blankToUndefined,
      z
        .url({ protocol: /^https?$/, message: 'invalid_url' })
        .max(500, { message: 'too_long' })
        .optional(),
    ),
    description: optionalText(1000),
    coverImageKey: optionalText(300),
    logoKey: optionalText(300),
    defaultAllowedCompanions: formInt(
      z
        .number({ message: 'invalid_number' })
        .int()
        .min(0, { message: 'out_of_range' })
        .max(20, { message: 'out_of_range' }),
    ).default(0),
    lifecycle: lifecycleOverridesSchema.default({}),
  })
  .superRefine((v, ctx) => {
    if (!(EVENT_TYPES_BY_CATEGORY[v.category] as readonly string[]).includes(v.type)) {
      ctx.addIssue({ code: 'custom', path: ['type'], message: 'type_category_mismatch' });
    }
    if (v.endsAt && isValidTimezone(v.timezone)) {
      if (localToUtc(v.endsAt, v.timezone) <= localToUtc(v.startsAt, v.timezone)) {
        ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'ends_before_start' });
      }
    }
  })
  .transform((v) => ({
    ...v,
    startsAt: localToUtc(v.startsAt, v.timezone),
    endsAt: v.endsAt ? localToUtc(v.endsAt, v.timezone) : null,
    address: v.address ?? null,
    mapsUrl: v.mapsUrl ?? null,
    description: v.description ?? null,
    coverImageKey: v.coverImageKey ?? null,
    logoKey: v.logoKey ?? null,
  }));

export type EventDetailsInput = z.input<typeof eventDetailsSchema>;
export type EventDetails = z.output<typeof eventDetailsSchema>;

export const cancellationReasonSchema = z
  .string({ message: 'required' })
  .trim()
  .min(1, { message: 'required' })
  .max(500, { message: 'too_long' });
