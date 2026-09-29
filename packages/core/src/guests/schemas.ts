import { z } from 'zod';
import { parsePhone } from '../shared/phone';
import { cleanText } from '../shared/text';

export const MAX_COMPANIONS = 20;
export const NAME_MAX = 150;
export const EMAIL_MAX = 254;
export const NOTES_MAX = 1000;
export const CANCEL_REASON_MAX = 300;
/** The most guests one bulk action may touch. */
export const BULK_MAX = 500;

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const formInt = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? Number(v) : v);

export const guestNameSchema = z
  .string({ message: 'required' })
  .transform(cleanText)
  .pipe(z.string().min(1, { message: 'required' }).max(NAME_MAX, { message: 'too_long' }));

/** A phone as typed, parsed to E.164; the error names what is wrong, never a guessed fix. */
export const guestPhoneSchema = z
  .string()
  .optional()
  .transform((v, ctx) => {
    const result = parsePhone(v);
    if (!result.ok) {
      ctx.addIssue({ code: 'custom', message: result.problem });
      return z.NEVER;
    }
    return { original: (v ?? '').trim(), e164: result.e164 };
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const guestEmailSchema = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .max(EMAIL_MAX, { message: 'too_long' })
    .regex(EMAIL, { message: 'invalid_email' })
    .optional(),
);

export const companionsSchema = z.preprocess(
  formInt,
  z
    .number({ message: 'out_of_range' })
    .int({ message: 'out_of_range' })
    .min(0, { message: 'out_of_range' })
    .max(MAX_COMPANIONS, { message: 'out_of_range' }),
);

export const guestNotesSchema = z.preprocess(
  blankToUndefined,
  z.string().trim().max(NOTES_MAX, { message: 'too_long' }).optional(),
);

const groupIdSchema = z.preprocess(
  (v) => (v === '' || v === 'none' ? null : v),
  z.uuid({ message: 'not_found' }).nullable().optional(),
);

const formFlag = z.preprocess(
  (v) => v === true || v === 'on' || v === 'true' || v === '1',
  z.boolean(),
);

/** Add and edit share one shape. Blank companions means "the event default" when adding. */
export const guestInputSchema = z.object({
  fullName: guestNameSchema,
  phone: guestPhoneSchema,
  email: guestEmailSchema,
  groupId: groupIdSchema,
  allowedCompanions: z.preprocess(blankToUndefined, companionsSchema.optional()),
  notes: guestNotesSchema,
  /** The owner saw the same-phone warning and chose to continue. */
  allowDuplicate: formFlag.optional(),
});
export type GuestInput = z.infer<typeof guestInputSchema>;

export const cancelInputSchema = z.object({
  reason: z.preprocess(
    blankToUndefined,
    z
      .string()
      .transform(cleanText)
      .pipe(z.string().max(CANCEL_REASON_MAX, { message: 'too_long' }))
      .optional(),
  ),
});

export const GUEST_STATUS_FILTERS = ['all', 'active', 'cancelled'] as const;
export const GUEST_SOURCE_FILTERS = ['all', 'manual', 'excel_import', 'walk_in'] as const;
/** Arrival at the door, for confirmed guests: nobody yet, part of the party, everyone. */
export const GUEST_ATTENDANCE_FILTERS = ['all', 'not_arrived', 'partial', 'complete'] as const;
export const GUEST_SORTS = ['recent', 'oldest', 'name'] as const;
export const GUEST_RSVP_FILTERS = ['all', 'pending', 'confirmed', 'declined'] as const;
/** Invitation progress: never handed off, shared but not yet opened, opened by the guest. */
export const GUEST_INVITE_FILTERS = ['all', 'not_shared', 'shared', 'opened'] as const;
export const PAGE_SIZES = [25, 50, 100] as const;

const oneOf = <T extends readonly [string, ...string[]]>(values: T, fallback: T[number]) =>
  z.preprocess((v) => ((values as readonly unknown[]).includes(v) ? v : fallback), z.enum(values));

/** List query from the URL. Unknown values fall back to defaults instead of failing. */
export const guestListQuerySchema = z.object({
  q: z.preprocess((v) => (typeof v === 'string' ? v.slice(0, 100) : ''), z.string()),
  status: oneOf(GUEST_STATUS_FILTERS, 'all'),
  source: oneOf(GUEST_SOURCE_FILTERS, 'all'),
  /** 'all', 'none' (no group) or a group id. */
  group: z.preprocess(
    (v) => (v === 'none' || (typeof v === 'string' && z.uuid().safeParse(v).success) ? v : 'all'),
    z.string(),
  ),
  rsvp: oneOf(GUEST_RSVP_FILTERS, 'all'),
  invite: oneOf(GUEST_INVITE_FILTERS, 'all'),
  attendance: oneOf(GUEST_ATTENDANCE_FILTERS, 'all'),
  sort: oneOf(GUEST_SORTS, 'recent'),
  page: z.preprocess((v) => {
    const n = Number(v);
    return Number.isInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
  }, z.number()),
  pageSize: z.preprocess((v) => {
    const n = Number(v);
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : 50;
  }, z.number()),
});
export type GuestListQuery = z.infer<typeof guestListQuerySchema>;

export const guestIdsSchema = z
  .array(z.uuid())
  .min(1, { message: 'required' })
  .max(BULK_MAX, { message: 'too_many_selected' })
  .transform((ids) => [...new Set(ids)]);
