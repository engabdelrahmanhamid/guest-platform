import { events, guestGroups, guests, invitations, rsvps } from '@gp/db/schema';
import { and, asc, count, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import { recordActivity } from '../activity/activity';
import { requireEventAccess } from '../authorization/authorization';
import { isEditable } from '../events/lifecycle';
import { writeXlsx } from '../guests/spreadsheet';
import type { CoreContext, DbOrTx } from '../shared/context';
import { DomainError } from '../shared/errors';
import { isPublicToken, publicToken } from '../shared/tokens';
import { designFor, type InvitationDesign } from './design';
import { activePass, type PassRow } from './passes';
import { markOpened } from './rsvp';
import { renderShareText, shareTextFor, whatsappUrl } from './share-text';
import {
  invitationPageState,
  type InvitationPageState,
  passDisplay,
  type PassDisplay,
  sharingOpen,
} from './state';

type EventRow = typeof events.$inferSelect;
export type InvitationRow = typeof invitations.$inferSelect;

/** The public link for a token. Only the token identifies the guest. */
export function invitationUrl(appBaseUrl: string, token: string): string {
  return `${appBaseUrl.replace(/\/+$/, '')}/i/${token}`;
}

/* ------------------------------------------------------------------------------------------ */
/* The guest's page                                                                           */
/* ------------------------------------------------------------------------------------------ */

export interface GuestPageView {
  state: InvitationPageState;
  event: Pick<
    EventRow,
    | 'name'
    | 'category'
    | 'type'
    | 'startsAt'
    | 'endsAt'
    | 'timezone'
    | 'city'
    | 'venueName'
    | 'address'
    | 'mapsUrl'
    | 'description'
    | 'coverImageKey'
    | 'logoKey'
    | 'status'
  >;
  design: InvitationDesign;
  /** Present only when the page is `open` or `closed`; never for an unavailable link. */
  guest: { fullName: string; allowedCompanions: number } | null;
  rsvp: { status: 'pending' | 'confirmed' | 'declined'; companionCount: number } | null;
  pass: { token: string; issuedAt: Date; display: PassDisplay } | null;
}

/**
 * Everything the guest page shows, looked up by token alone. An unknown token returns null (the
 * page answers 404). For a draft or disabled event, or a cancelled guest, the view carries no
 * personal data. Reading never writes; opens are counted by the page's beacon.
 */
export async function getGuestPage(ctx: CoreContext, token: string): Promise<GuestPageView | null> {
  if (!isPublicToken(token)) return null;
  const [row] = await ctx.db
    .select({ inv: invitations, event: events, guest: guests, rsvp: rsvps })
    .from(invitations)
    .innerJoin(events, eq(events.id, invitations.eventId))
    .innerJoin(guests, eq(guests.id, invitations.guestId))
    .innerJoin(rsvps, eq(rsvps.guestId, invitations.guestId))
    .where(eq(invitations.token, token));
  if (!row || row.guest.anonymizedAt) return null;
  const { event, guest, rsvp } = row;
  return buildGuestPage(ctx.db, event, guest, rsvp);
}

async function buildGuestPage(
  db: DbOrTx,
  event: EventRow,
  guest: typeof guests.$inferSelect | null,
  rsvp: typeof rsvps.$inferSelect | null,
  sample?: { pass: PassRow | null },
): Promise<GuestPageView> {
  const state = guest
    ? invitationPageState(event, guest)
    : invitationPageState(event, { status: 'active' });
  const design = await designFor(db, event);
  const publicEvent = {
    name: event.name,
    category: event.category,
    type: event.type,
    startsAt: event.startsAt,
    endsAt: event.endsAt,
    timezone: event.timezone,
    city: event.city,
    venueName: event.venueName,
    address: event.address,
    mapsUrl: event.mapsUrl,
    description: event.description,
    coverImageKey: event.coverImageKey,
    logoKey: event.logoKey,
    status: event.status,
  };
  if (state === 'unavailable' || !guest || !rsvp) {
    return { state, event: publicEvent, design, guest: null, rsvp: null, pass: null };
  }
  const pass = sample ? sample.pass : await activePass(db, guest.id);
  return {
    state,
    event: publicEvent,
    design,
    guest:
      state === 'cancelled'
        ? null
        : { fullName: guest.fullName, allowedCompanions: guest.allowedCompanions },
    rsvp:
      state === 'cancelled' ? null : { status: rsvp.status, companionCount: rsvp.companionCount },
    // A cancelled event never shows a QR.
    pass:
      pass && state !== 'cancelled'
        ? {
            token: pass.token,
            issuedAt: pass.issuedAt,
            display: passDisplay(pass, guest, rsvp, event),
          }
        : null,
  };
}

/**
 * The owner's preview of the guest page, for a real guest of the event or a sample guest. It is
 * read-only by construction: it loads data and never writes, and the page it feeds renders its
 * answer buttons without a working form.
 */
export async function getInvitationPreview(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  opts: { guestId?: string | null; as?: 'pending' | 'confirmed' | 'declined' } = {},
): Promise<GuestPageView & { sample: boolean }> {
  const { event } = await requireEventAccess(ctx.db, userId, eventId, 'invitations.manage');
  // Preview always shows the invitation as guests will see it once the event is published.
  const shown = event.status === 'draft' ? { ...event, status: 'active' as const } : event;
  if (opts.guestId) {
    const [row] = await ctx.db
      .select({ guest: guests, rsvp: rsvps })
      .from(guests)
      .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
      .where(
        and(eq(guests.eventId, eventId), eq(guests.id, opts.guestId), isNull(guests.anonymizedAt)),
      );
    if (row) {
      const view = await buildGuestPage(ctx.db, shown, row.guest, row.rsvp);
      return { ...view, sample: false };
    }
  }
  const now = ctx.now();
  const status = opts.as ?? 'pending';
  const sampleGuest = {
    id: '00000000-0000-7000-8000-000000000000',
    eventId,
    status: 'active' as const,
    fullName: 'محمد العتيبي',
    allowedCompanions: Math.max(event.defaultAllowedCompanions, 2),
  } as typeof guests.$inferSelect;
  const sampleRsvp = {
    status,
    companionCount: status === 'confirmed' ? 1 : 0,
  } as typeof rsvps.$inferSelect;
  const samplePass =
    status === 'confirmed'
      ? ({
          token: 'PREVIEW0000000000000000'.slice(0, 22),
          status: 'active',
          issuedAt: now,
        } as PassRow)
      : null;
  const view = await buildGuestPage(ctx.db, shown, sampleGuest, sampleRsvp, { pass: samplePass });
  return { ...view, sample: true };
}

/**
 * The page's open beacon: counted only when a browser ran the page's script, so link previews
 * (WhatsApp and others fetch the page without running scripts) don't count as opens.
 */
export async function recordInvitationOpen(ctx: CoreContext, token: string): Promise<boolean> {
  if (!isPublicToken(token)) return false;
  return ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .select({ inv: invitations, event: events })
      .from(invitations)
      .innerJoin(events, eq(events.id, invitations.eventId))
      .where(eq(invitations.token, token));
    if (!row) return false;
    if (row.event.status === 'draft' || row.event.disabledAt) return false;
    await markOpened(tx, row.inv, row.event, ctx.now());
    return true;
  });
}

/* ------------------------------------------------------------------------------------------ */
/* Owner actions on one invitation                                                            */
/* ------------------------------------------------------------------------------------------ */

async function lockInvitation(tx: DbOrTx, eventId: string, guestId: string) {
  const [g] = await tx
    .select({ id: guests.id, status: guests.status, anonymizedAt: guests.anonymizedAt })
    .from(guests)
    .where(and(eq(guests.eventId, eventId), eq(guests.id, guestId)))
    .for('update');
  if (!g || g.anonymizedAt) throw new DomainError('not_found');
  const [inv] = await tx.select().from(invitations).where(eq(invitations.guestId, guestId));
  if (!inv) throw new DomainError('not_found');
  return { guest: g, inv };
}

/** Gives the guest a new link; the old one stops working at once. The pass is not touched. */
export async function rotateInvitationLink(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
): Promise<{ token: string }> {
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireEventAccess(tx, userId, eventId, 'invitations.manage', {
      forShare: true,
    });
    if (!isEditable(event)) {
      throw new DomainError('event_not_editable', undefined, { status: event.status });
    }
    const { inv } = await lockInvitation(tx, eventId, guestId);
    const token = publicToken();
    const now = ctx.now();
    await tx
      .update(invitations)
      .set({ token, tokenRotatedAt: now, updatedAt: now })
      .where(eq(invitations.id, inv.id));
    await recordActivity(tx, {
      type: 'invitation.token_rotated',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      guestId,
    });
    return { token };
  });
}

export type ShareMethod = 'whatsapp' | 'copy_link' | 'copy_text';

/**
 * Records that the owner handed the invitation off (opened WhatsApp with it, or copied it).
 * This is "shared", never "delivered": nobody knows whether the message was sent or arrived.
 */
export async function recordInvitationShare(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
  method: ShareMethod,
): Promise<{ first: boolean }> {
  return ctx.db.transaction(async (tx) => {
    const { event, actor } = await requireEventAccess(tx, userId, eventId, 'invitations.manage', {
      forShare: true,
    });
    if (!sharingOpen(event)) {
      throw new DomainError(
        event.status === 'draft' ? 'event_not_published' : 'event_not_editable',
        undefined,
        {
          status: event.status,
        },
      );
    }
    const { guest, inv } = await lockInvitation(tx, eventId, guestId);
    if (guest.status !== 'active') throw new DomainError('guest_not_active');
    const now = ctx.now();
    const first = inv.shareCount === 0;
    await tx
      .update(invitations)
      .set({
        shareCount: sql`${invitations.shareCount} + 1`,
        firstSharedAt: inv.firstSharedAt ?? now,
        lastSharedAt: now,
        // Keeps the highest level reached: a manual share never lowers sent/delivered.
        deliveryStatus: ['not_sent', 'failed', 'queued'].includes(inv.deliveryStatus)
          ? 'shared'
          : inv.deliveryStatus,
        updatedAt: now,
      })
      .where(eq(invitations.id, inv.id));
    await recordActivity(tx, {
      type: 'invitation.shared',
      actor,
      eventId,
      workspaceId: event.workspaceId,
      guestId,
      data: { method, first },
    });
    return { first };
  });
}

export interface ShareContent {
  guestId: string;
  guestName: string;
  phoneE164: string | null;
  groupName: string | null;
  link: string;
  text: string;
  waUrl: string | null;
  shareCount: number;
  lastSharedAt: Date | null;
  openedAt: Date | null;
  rsvpStatus: 'pending' | 'confirmed' | 'declined';
}

async function shareContentFor(
  ctx: CoreContext,
  event: EventRow,
  where: SQL,
  body: string,
): Promise<ShareContent | null> {
  const [row] = await ctx.db
    .select({
      guestId: guests.id,
      guestName: guests.fullName,
      phoneE164: guests.phoneE164,
      groupName: guestGroups.name,
      token: invitations.token,
      shareCount: invitations.shareCount,
      lastSharedAt: invitations.lastSharedAt,
      openedAt: invitations.openedAt,
      rsvpStatus: rsvps.status,
    })
    .from(guests)
    .innerJoin(invitations, eq(invitations.guestId, guests.id))
    .innerJoin(rsvps, eq(rsvps.guestId, guests.id))
    .leftJoin(guestGroups, eq(guestGroups.id, guests.groupId))
    .where(where)
    .orderBy(asc(guests.createdAt), asc(guests.id))
    .limit(1);
  if (!row) return null;
  const link = invitationUrl(ctx.appBaseUrl, row.token);
  const text = renderShareText(body, {
    guestName: row.guestName,
    eventName: event.name,
    startsAt: event.startsAt,
    timezone: event.timezone,
    venueName: event.venueName,
    link,
  });
  return {
    guestId: row.guestId,
    guestName: row.guestName,
    phoneE164: row.phoneE164,
    groupName: row.groupName,
    shareCount: row.shareCount,
    lastSharedAt: row.lastSharedAt,
    openedAt: row.openedAt,
    rsvpStatus: row.rsvpStatus,
    link,
    text,
    waUrl: whatsappUrl(row.phoneE164, text),
  };
}

/** The prepared message, link and WhatsApp link for one guest (drawer and share queue). */
export async function getShareContent(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  guestId: string,
): Promise<ShareContent> {
  const { event } = await requireEventAccess(ctx.db, userId, eventId, 'invitations.manage');
  const body = await shareTextFor(ctx.db, eventId);
  const content = await shareContentFor(
    ctx,
    event,
    and(eq(guests.eventId, eventId), eq(guests.id, guestId), isNull(guests.anonymizedAt))!,
    body,
  );
  if (!content) throw new DomainError('not_found');
  return content;
}

/* ------------------------------------------------------------------------------------------ */
/* Share queue: one guest at a time                                                           */
/* ------------------------------------------------------------------------------------------ */

export const SHARE_QUEUE_FILTERS = ['not_shared', 'shared_not_opened', 'opened', 'all'] as const;
export type ShareQueueFilter = (typeof SHARE_QUEUE_FILTERS)[number];

function queueFilter(eventId: string, filter: ShareQueueFilter): SQL {
  const where: (SQL | undefined)[] = [
    eq(guests.eventId, eventId),
    eq(guests.status, 'active'),
    isNull(guests.anonymizedAt),
  ];
  if (filter === 'not_shared') where.push(eq(invitations.shareCount, 0));
  if (filter === 'shared_not_opened') {
    where.push(gt(invitations.shareCount, 0), isNull(invitations.openedAt));
  }
  if (filter === 'opened') where.push(sql`${invitations.openedAt} IS NOT NULL`);
  return and(...where)!;
}

export interface ShareQueueView {
  filter: ShareQueueFilter;
  current: ShareContent | null;
  /** Guests matching the filter, and how many come after the current one. */
  total: number;
  remaining: number;
  counts: Record<ShareQueueFilter, number>;
  canShare: boolean;
}

/**
 * The share queue walks the active guests in the order they were added. `after` is the last guest
 * the owner moved past; the next guest is the first matching one after it. Guests leave the
 * "not shared" queue as soon as they are shared, so the owner can stop and pick up anywhere.
 */
export async function getShareQueue(
  ctx: CoreContext,
  userId: string,
  eventId: string,
  opts: { filter?: ShareQueueFilter; after?: string | null } = {},
): Promise<ShareQueueView> {
  const { event } = await requireEventAccess(ctx.db, userId, eventId, 'invitations.manage');
  const filter = opts.filter ?? 'not_shared';
  const base = queueFilter(eventId, filter);

  let afterCond: SQL | undefined;
  if (opts.after) {
    const [a] = await ctx.db
      .select({ createdAt: guests.createdAt, id: guests.id })
      .from(guests)
      .where(and(eq(guests.eventId, eventId), eq(guests.id, opts.after)));
    if (a) {
      afterCond = or(
        gt(guests.createdAt, a.createdAt),
        and(eq(guests.createdAt, a.createdAt), gt(guests.id, a.id)),
      );
    }
  }
  const body = await shareTextFor(ctx.db, eventId);
  const current = await shareContentFor(ctx, event, and(base, afterCond)!, body);

  const countWhere = (w: SQL) =>
    ctx.db
      .select({ n: count() })
      .from(guests)
      .innerJoin(invitations, eq(invitations.guestId, guests.id))
      .where(w)
      .then((r) => Number(r[0]?.n ?? 0));
  const [notShared, sharedNotOpened, opened, all] = await Promise.all(
    SHARE_QUEUE_FILTERS.map((f) => countWhere(queueFilter(eventId, f))),
  );
  const counts = {
    not_shared: notShared!,
    shared_not_opened: sharedNotOpened!,
    opened: opened!,
    all: all!,
  };
  const remaining = current
    ? await countWhere(
        and(
          base,
          or(
            gt(
              guests.createdAt,
              sql`(SELECT created_at FROM guests WHERE id = ${current.guestId})`,
            ),
            and(
              eq(
                guests.createdAt,
                sql`(SELECT created_at FROM guests WHERE id = ${current.guestId})`,
              ),
              gt(guests.id, current.guestId),
            ),
          ),
        )!,
      )
    : 0;
  return {
    filter,
    current,
    total: counts[filter],
    remaining,
    counts,
    canShare: sharingOpen(event),
  };
}

/* ------------------------------------------------------------------------------------------ */
/* Export                                                                                     */
/* ------------------------------------------------------------------------------------------ */

export const INVITATION_EXPORT_HEADERS = [
  'اسم الضيف',
  'الجوال',
  'رابط الدعوة',
  'المجموعة',
] as const;

/**
 * Name, phone, personal link and group for every active guest, so trusted family or team
 * members can help share. Cells are written as text and formula-escaped. Exporting is recorded
 * as an event activity, but it does not mark anyone as shared (the app can't know who sent what).
 */
export async function exportInvitationLinks(
  ctx: CoreContext,
  userId: string,
  eventId: string,
): Promise<{ file: Uint8Array; rows: number; eventName: string }> {
  const { event, actor } = await requireEventAccess(ctx.db, userId, eventId, 'invitations.manage');
  if (!sharingOpen(event)) {
    throw new DomainError(
      event.status === 'draft' ? 'event_not_published' : 'event_not_editable',
      undefined,
      {
        status: event.status,
      },
    );
  }
  const rows = await ctx.db
    .select({
      name: guests.fullName,
      phone: guests.phoneE164,
      token: invitations.token,
      group: guestGroups.name,
    })
    .from(guests)
    .innerJoin(invitations, eq(invitations.guestId, guests.id))
    .leftJoin(guestGroups, eq(guestGroups.id, guests.groupId))
    .where(
      and(eq(guests.eventId, eventId), eq(guests.status, 'active'), isNull(guests.anonymizedAt)),
    )
    .orderBy(asc(guests.createdAt), asc(guests.id));
  const [name, phone, link, group] = INVITATION_EXPORT_HEADERS;
  const file = writeXlsx(
    'روابط الدعوات',
    [
      { header: name, width: 28 },
      { header: phone, width: 18, text: true },
      { header: link, width: 48, text: true },
      { header: group, width: 18 },
    ],
    rows.map((r) => [r.name, r.phone ?? '', invitationUrl(ctx.appBaseUrl, r.token), r.group ?? '']),
  );
  await recordActivity(ctx.db, {
    type: 'invitation.links_exported',
    actor,
    eventId,
    workspaceId: event.workspaceId,
    data: { rows: rows.length },
  });
  return { file, rows: rows.length, eventName: event.name };
}
