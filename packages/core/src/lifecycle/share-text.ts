import { messageTemplates } from '@gp/db/schema';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordActivity } from '../activity/activity';
import { requireEventAccess } from '../authorization/authorization';
import { isEditable } from '../events/lifecycle';
import type { CoreContext, DbOrTx } from '../shared/context';
import { formatEventDate, formatEventTime } from '../shared/datetime';
import { DomainError } from '../shared/errors';
import { newId } from '../shared/ids';
import { parseInput } from '../shared/validation';

/** The placeholders an owner may use in the share text. `{link}` must always be there. */
export const SHARE_PLACEHOLDERS = [
  'guest_name',
  'event_name',
  'date',
  'time',
  'venue',
  'link',
] as const;
export type SharePlaceholder = (typeof SHARE_PLACEHOLDERS)[number];
export const SHARE_TEXT_MAX = 1000;

/** The Arabic text every event starts with. Warm but neutral, so it suits weddings and business. */
export const DEFAULT_SHARE_TEXT = [
  'السلام عليكم {guest_name}',
  '',
  'يسعدنا دعوتكم لحضور {event_name}',
  '{date} الساعة {time}',
  '{venue}',
  '',
  'تفضلوا بتأكيد حضوركم من خلال الرابط:',
  '{link}',
].join('\n');

const PLACEHOLDER = /\{([a-z_]+)\}/g;

export const shareTextSchema = z.object({
  body: z
    .string({ message: 'required' })
    .transform((v) => v.replace(/\r\n?/g, '\n').trim())
    .pipe(
      z
        .string()
        .min(1, { message: 'required' })
        .max(SHARE_TEXT_MAX, { message: 'too_long' })
        .refine((v) => v.includes('{link}'), { message: 'missing_link' })
        .refine(
          (v) =>
            [...v.matchAll(PLACEHOLDER)].every((m) =>
              (SHARE_PLACEHOLDERS as readonly string[]).includes(m[1]!),
            ),
          { message: 'unknown_placeholder' },
        ),
    ),
});

export async function shareTextFor(db: DbOrTx, eventId: string): Promise<string> {
  const [row] = await db
    .select({ body: messageTemplates.body })
    .from(messageTemplates)
    .where(
      and(
        eq(messageTemplates.eventId, eventId),
        eq(messageTemplates.type, 'invitation'),
        eq(messageTemplates.locale, 'ar'),
      ),
    );
  return row?.body ?? DEFAULT_SHARE_TEXT;
}

export interface ShareVariables {
  guestName: string;
  eventName: string;
  startsAt: Date;
  timezone: string;
  venueName: string;
  link: string;
}

/** Fills the placeholders. Values are inserted as plain text; nothing is interpreted. */
export function renderShareText(body: string, v: ShareVariables): string {
  const values: Record<SharePlaceholder, string> = {
    guest_name: v.guestName,
    event_name: v.eventName,
    date: formatEventDate(v.startsAt, v.timezone),
    time: formatEventTime(v.startsAt, v.timezone),
    venue: v.venueName,
    link: v.link,
  };
  return body.replace(PLACEHOLDER, (m, key: string) =>
    key in values ? values[key as SharePlaceholder] : m,
  );
}

/**
 * The wa.me link that opens WhatsApp (app or web) with the text ready for this number. Nothing is
 * sent until the owner presses send in WhatsApp.
 */
export function whatsappUrl(phoneE164: string | null, text: string): string | null {
  if (!phoneE164) return null;
  return `https://wa.me/${phoneE164.replace(/^\+/, '')}?text=${encodeURIComponent(text)}`;
}

export async function getShareText(ctx: CoreContext, userId: string, eventId: string) {
  await requireEventAccess(ctx.db, userId, eventId, 'invitations.manage');
  const body = await shareTextFor(ctx.db, eventId);
  return { body, isDefault: body === DEFAULT_SHARE_TEXT };
}

export async function saveShareText(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  input: unknown,
) {
  const { body } = parseInput(shareTextSchema, input);
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireEventAccess(tx, userId, eventId, 'invitations.manage', {
      forUpdate: true,
    });
    if (!isEditable(event)) {
      throw new DomainError('event_not_editable', undefined, { status: event.status });
    }
    const current = await shareTextFor(tx, eventId);
    if (current === body) return { changed: false };
    const now = ctx.now();
    await tx
      .insert(messageTemplates)
      .values({
        id: newId(),
        eventId,
        type: 'invitation',
        locale: 'ar',
        body,
        updatedByMembershipId: actor.membershipId,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [messageTemplates.eventId, messageTemplates.type, messageTemplates.locale],
        set: { body, updatedByMembershipId: actor.membershipId, updatedAt: now },
      });
    await recordActivity(tx, {
      type: 'invitation.share_text_updated',
      actor,
      eventId,
      workspaceId: event.workspaceId,
    });
    return { changed: true };
  });
}
