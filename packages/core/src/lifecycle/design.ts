import { events, invitationDesigns } from '@gp/db/schema';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { recordActivity } from '../activity/activity';
import { requireEventAccess } from '../authorization/authorization';
import { isEditable } from '../events/lifecycle';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { publicToken } from '../shared/tokens';
import { parseInput } from '../shared/validation';
import { type ImageKind, processImage } from '../storage/images';

/**
 * The limited design system: four templates, one colour, the wording and which details show.
 * No free layout. Defaults come from the event's type until the owner saves the design once.
 */
export const INVITATION_TEMPLATES = ['elegant', 'celebration', 'formal', 'minimal'] as const;
export type InvitationTemplate = (typeof INVITATION_TEMPLATES)[number];

/** Curated colours; each keeps white text readable on it (at least 4.5:1). */
export const DESIGN_COLORS = [
  '#0e5a4b',
  '#7a5a2b',
  '#8c2f45',
  '#1f3a5f',
  '#5a4a86',
  '#2e5e66',
  '#9a4a2a',
  '#33403b',
] as const;

export const DESIGN_TITLE_MAX = 120;
export const DESIGN_BODY_MAX = 600;

type EventRow = typeof events.$inferSelect;
type DesignRow = typeof invitationDesigns.$inferSelect;

const TEMPLATE_FOR_TYPE: Record<EventRow['type'], InvitationTemplate> = {
  wedding: 'elegant',
  malka: 'elegant',
  engagement: 'elegant',
  graduation: 'celebration',
  birthday: 'celebration',
  private_dinner: 'minimal',
  conference: 'formal',
  corporate: 'formal',
  ceremony: 'formal',
  product_launch: 'minimal',
  opening: 'minimal',
  exhibition: 'minimal',
  other: 'minimal',
};

const COLOR_FOR_TEMPLATE: Record<InvitationTemplate, string> = {
  elegant: '#7a5a2b',
  celebration: '#8c2f45',
  formal: '#1f3a5f',
  minimal: '#33403b',
};

/** The invitation line under the greeting, by event category. The owner can replace it. */
export function defaultInvitationLine(category: EventRow['category']): string {
  return category === 'business' ? 'يسرّنا دعوتكم لحضور' : 'يسرّنا دعوتك لحضور';
}

export interface InvitationDesign {
  template: InvitationTemplate;
  primaryColor: string;
  /** Headline; the event name unless the owner wrote their own. */
  title: string;
  customTitle: string | null;
  /** The owner's message, shown under the event details. Null when there is none. */
  bodyText: string | null;
  showDate: boolean;
  showTime: boolean;
  showVenue: boolean;
  showAddress: boolean;
  showMap: boolean;
  showDescription: boolean;
  showCountdown: boolean;
  /** Whether the owner has saved a design (otherwise these are the defaults). */
  saved: boolean;
}

export function resolveDesign(
  event: EventRow,
  row: DesignRow | null | undefined,
): InvitationDesign {
  const template = row?.template ?? TEMPLATE_FOR_TYPE[event.type];
  return {
    template,
    primaryColor: row?.primaryColor ?? COLOR_FOR_TEMPLATE[template],
    title: row?.title ?? event.name,
    customTitle: row?.title ?? null,
    bodyText: row?.bodyText ?? null,
    showDate: row?.showDate ?? true,
    showTime: row?.showTime ?? true,
    showVenue: row?.showVenue ?? true,
    showAddress: row?.showAddress ?? true,
    showMap: row?.showMap ?? true,
    showDescription: row?.showDescription ?? true,
    showCountdown: row?.showCountdown ?? true,
    saved: Boolean(row),
  };
}

export async function designFor(db: DbOrTx, event: EventRow): Promise<InvitationDesign> {
  const [row] = await db
    .select()
    .from(invitationDesigns)
    .where(eq(invitationDesigns.eventId, event.id));
  return resolveDesign(event, row);
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast of white text on this colour. Custom colours must keep it at 4.5:1 or more. */
export function whiteContrast(hex: string): number {
  return 1.05 / (luminance(hex) + 0.05);
}

const flag = z.preprocess(
  (v) => v === true || v === 'on' || v === 'true' || v === '1',
  z.boolean(),
);
const optionalText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim() : v),
    z
      .string()
      .max(max, { message: 'too_long' })
      .optional()
      .transform((v) => (v ? v : null)),
  );

export const designInputSchema = z.object({
  template: z.enum(INVITATION_TEMPLATES, { message: 'required' }),
  primaryColor: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^#[0-9a-f]{6}$/, { message: 'invalid_color' })
    .refine((c) => whiteContrast(c) >= 4.5, { message: 'color_too_light' }),
  title: optionalText(DESIGN_TITLE_MAX),
  bodyText: optionalText(DESIGN_BODY_MAX),
  showDate: flag,
  showTime: flag,
  showVenue: flag,
  showAddress: flag,
  showMap: flag,
  showDescription: flag,
  showCountdown: flag,
});

async function requireDesignEdit(tx: DbOrTx, userId: string, eventId: string) {
  const access = await requireEventAccess(tx, userId, eventId, 'invitations.manage', {
    forUpdate: true,
  });
  if (!isEditable(access.event)) {
    throw new DomainError('event_not_editable', undefined, { status: access.event.status });
  }
  return access;
}

export async function getInvitationDesign(ctx: CoreContext, userId: string, eventId: string) {
  const { event } = await requireEventAccess(ctx.db, userId, eventId, 'invitations.manage');
  return { event, design: await designFor(ctx.db, event) };
}

export async function saveInvitationDesign(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  input: unknown,
) {
  const data = parseInput(designInputSchema, input);
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireDesignEdit(tx, userId, eventId);
    const now = ctx.now();
    const values = { ...data, updatedByMembershipId: actor.membershipId, updatedAt: now };
    await tx
      .insert(invitationDesigns)
      .values({ eventId, ...values, createdAt: now })
      .onConflictDoUpdate({ target: invitationDesigns.eventId, set: values });
    await recordActivity(tx, {
      type: 'invitation.design_updated',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { template: data.template },
    });
    return { saved: true };
  });
}

const KEY_COLUMN = { cover: 'coverImageKey', logo: 'logoKey' } as const;

/**
 * Stores a new cover or logo. The image is checked and re-encoded first; the object is written
 * before the event points at it, and the previous object is removed after the change commits.
 */
export async function uploadEventImage(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  kind: ImageKind,
  bytes: Buffer,
): Promise<{ key: string }> {
  // Check access before spending time on the image.
  await requireEventAccess(ctx.db, userId, eventId, 'invitations.manage');
  const image = await processImage(kind, bytes);
  const key = `event-media/${publicToken()}.webp`;
  await ctx.storage.put(key, image.body, image.contentType);
  let previous: string | null = null;
  try {
    await ctx.db.transaction(async (tx) => {
      const { event, actor } = await requireDesignEdit(tx, userId, eventId);
      previous = event[KEY_COLUMN[kind]];
      await tx
        .update(events)
        .set({ [KEY_COLUMN[kind]]: key, updatedAt: ctx.now() })
        .where(eq(events.id, eventId));
      await recordActivity(tx, {
        type: 'invitation.design_updated',
        actor,
        eventId,
        workspaceId: event.workspaceId,
        data: { image: kind, change: 'replaced' },
      });
    });
  } catch (err) {
    await ctx.storage.delete(key).catch(() => undefined);
    throw err;
  }
  if (previous) await ctx.storage.delete(previous).catch(() => undefined);
  return { key };
}

export async function removeEventImage(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  kind: ImageKind,
): Promise<void> {
  let previous: string | null = null;
  await ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireDesignEdit(tx, userId, eventId);
    previous = event[KEY_COLUMN[kind]];
    if (!previous) return;
    await tx
      .update(events)
      .set({ [KEY_COLUMN[kind]]: null, updatedAt: ctx.now() })
      .where(eq(events.id, eventId));
    await recordActivity(tx, {
      type: 'invitation.design_updated',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      data: { image: kind, change: 'removed' },
    });
  });
  if (previous) await ctx.storage.delete(previous).catch(() => undefined);
}

/**
 * Who may load an event image. Images are part of the invitation, so anyone may see them once
 * the event is published; before that only the event's owner (for the preview) can.
 */
export async function readEventImage(
  ctx: CoreContext,
  key: string,
  viewerUserId: string | null,
): Promise<{ body: Buffer; contentType: string; isPublic: boolean } | null> {
  if (!/^event-media\/[0-9A-Za-z]{22}\.webp$/.test(key)) return null;
  const [event] = await ctx.db
    .select({ id: events.id, status: events.status, disabledAt: events.disabledAt })
    .from(events)
    .where(eq(events.coverImageKey, key))
    .union(
      ctx.db
        .select({ id: events.id, status: events.status, disabledAt: events.disabledAt })
        .from(events)
        .where(eq(events.logoKey, key)),
    );
  if (!event) return null;
  const isPublic = event.status !== 'draft' && !event.disabledAt;
  if (!isPublic) {
    if (!viewerUserId) return null;
    try {
      await requireEventAccess(ctx.db, viewerUserId, event.id, 'invitations.manage');
    } catch {
      return null;
    }
  }
  const object = await ctx.storage.get(key);
  return object ? { ...object, isPublic } : null;
}
