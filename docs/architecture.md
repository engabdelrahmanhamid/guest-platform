# Architecture (approved)

Architecture Proposal v0.2 was approved by Abderahman on 2026-09-28, including the final
amendments. The full proposal (ERD, schema, state machines, permissions, concurrency, messaging,
import, security, phases) is at
https://claude.ai/artifact/F9LFdQ1aQQG6aRzpADdgE5. This file records the decisions code must follow.
A change to any of them needs the product owner's approval.

## Shape

- TypeScript modular monolith: `apps/web` (Next.js: owner app, guest pages, staff scanner, admin,
  API), `apps/worker` (pg-boss jobs), `packages/core` (framework-free domain), `packages/db`
  (Drizzle schema and SQL migrations).
- PostgreSQL 16 is the only datastore and the job queue. No Redis.
- Primary data, backups and object storage live in a Saudi cloud region. External tools
  (error tracking, account email) never receive guest personal data.
- Modules write only their own tables. Every write touching a guest runs under a row lock on
  that guest.

## Domain rules

- Events belong to workspaces. Every user gets a hidden personal workspace.
- Event states: `draft`, `active`, `live`, `completed`, `cancelled`, `archived`.
  - `active → cancelled` and `live → cancelled` (the latter only while nobody is checked in);
    `completed → archived`, `cancelled → archived`.
  - Cancellation stops RSVP, check-in and passes through event-state checks, rewrites no history,
    and keeps `cancelled_at` after archiving.
- Lifecycle timing (check-in open/close offsets, assumed duration, reopen window, auto-archive
  delay) comes from per-event columns pre-filled from admin-editable `platform_settings`
  (`lifecycle.*`, `auto_archive.days`, `retention.guest_pii_days`). Nothing is hard-coded.
- Staff are `event_memberships` rows (no user account). Access is a one-time link, redeemed by
  an explicit tap, bound to one device. `is_supervisor` allows walk-ins, confirming unanswered
  guests at the door, attendance corrections (reason required) and revoking/resending staff
  access. No permission builder.
- Every event-scoped action records the acting membership.
- Guest passes are stored as `active` or `revoked` only. Expiry is derived from event state. A
  pass is issued when the RSVP is confirmed; re-confirmation issues a new token.
- Expected party size = `1 + companions` when the guest is active and the RSVP confirmed.
  It never depends on the pass. Final reports are frozen as snapshots.
- Attendance is an append-only ledger (`check_in_logs`) with a current-total projection and a
  client-generated idempotency key per tap.
- QR payload is `GP1.<opaque token>`. It is not a URL and contains no personal data or internal
  ids. Invitation and pass tokens are separate.
- Messaging: `MessagingService` → `MessagingProvider` port. V1 ships `MockProvider`,
  Share via WhatsApp (`wa.me` with prepared text) with a share queue, copy link, and an export of
  guest name/phone/link. Provider-specific code lives only in `integrations/`.
- **No SMS** anywhere, not even as a fallback. Email is not a guest channel in V1.
- Personal-data retention duration is TBD. The anonymization job is off until an admin sets it.

## Guest management (phase 2)

Implementation choices made in phase 2. Items marked _awaiting approval_ differ from the proposal
or fill a gap in it, and stay open until the product owner confirms them.

- A guest belongs to one event; the UUID is the identity. Phones are stored as typed and as
  E.164 (default region SA) and are not unique: the same number is a warning with "add anyway".
- Phone is required for manual and imported guests. A missing phone in a spreadsheet makes the
  row invalid (the proposal said "needs review"). _Awaiting approval._
- Cancelling keeps the guest (status `cancelled`, optional reason shown to the owner only);
  restoring returns it to `active`. Hard delete goes only through `canHardDeleteGuest`, which
  later phases tighten (link shared or opened, messaged, checked in).
- Guests can be changed while the event is draft, active or live and not disabled.
- Activity records field names and ids, never names, phones, emails, notes or reasons.
- Spreadsheet imports (.xlsx/.csv, 5 MB, 5,000 rows, first sheet, cached values only) are read
  during the upload request, not in the worker, and the file is not stored: only its hash, name
  and size, plus the staged rows. There is no object storage yet. _Awaiting approval._
- Rows needing review have no default decision and must be decided before commit, except exact
  repeats (same phone and name), which start as skip. Invalid rows can only be skipped; fixing
  them means correcting the file and uploading it again.
- Commit is one transaction under the event lock; each staged row can create at most one guest,
  and rows are re-checked against the current list before anything is written. Staged rows are
  deleted 30 days after an import ends.

## Guest experience (phase 3)

Implementation choices made in phase 3. Items marked _awaiting approval_ differ from the proposal
or fill a gap in it.

- Invitation, RSVP, pass and design are separate tables (`invitations`, `rsvps`, `guest_passes`,
  `invitation_designs`, plus `message_templates` for the share text). Each guest gets one
  invitation and one `pending` RSVP when it is created; migration 0004 backfills existing guests.
- Invitation and pass tokens are 22 random base62 characters (about 131 bits), separate from each
  other, stored in plain text so the owner can re-share the link, and never logged. The link is
  `/i/<token>` with no id or phone in it. Rotating a link replaces the token at once.
- Delivery status: phase 3 uses `not_sent` and `shared` only ("shared" = the owner opened WhatsApp
  with the message or copied the link or message; it never means delivered). `queued`, `sent`,
  `delivered`, `read` and `failed` exist for the messaging phase. Share records live on the
  invitation and in activity; `messages`/`message_batches` wait for phase 5.
- Opens are counted by a script beacon after the page has been visible for about a second, so
  link-preview bots never count. Visits less than 30 minutes apart are one open. Answering also
  counts as an open.
- RSVP: `pending → confirmed | declined`, `confirmed ↔ declined`, never back to pending; no
  "maybe". Declining sets companions to 0 and revokes the pass; confirming again issues a new
  pass token. Repeating the current answer writes nothing. The owner may record an answer (history
  names the owner's membership) while the event is active or live.
- At most one active pass per guest (unique partial index), and a deferred constraint trigger
  keeps "active pass ⇔ active guest with a confirmed RSVP". A pass is never revoked on its own:
  it is revoked by declining, by cancelling the guest, or by being replaced with a new one.
  Cancelling an event revokes nothing; the pass shows as cancelled from the event state.
- Guest page by event state: draft or disabled → "not available" with no personal data;
  active and live → invitation with RSVP; completed → read-only, pass shown as ended;
  cancelled → cancellation notice, no pass; **archived → read-only like completed, or the
  cancellation notice if the event was cancelled before archiving**. _Awaiting approval._
- Sharing and the links export are allowed while the event is active or live (not in draft).
  The design and share text can be edited while the event is draft, active or live.
- Design: four templates (elegant, celebration, formal, minimal), one primary colour (custom
  colours must keep white text at 4.5:1 or more), title, message, seven show/hide switches.
  Cover and logo are JPEG/PNG/WebP, checked by content, re-encoded to WebP without metadata,
  stored in private object storage under random keys, and served through `/media/…` only once the
  event is published (the owner can see them earlier for the preview).
- Public pages: rate limits per client (a keyed hash of the IP, never the IP) and per link; a
  client that presents more than 30 unknown tokens in 15 minutes is blocked for the window.
  Responses are `private, no-store`, `noindex`, and `Referrer-Policy: same-origin` (not
  `no-referrer` as in the proposal: under `no-referrer` browsers send `Origin: null` on form
  posts, which breaks the RSVP form without JavaScript; the token still never reaches other
  sites). _Awaiting approval._
- Hard delete is refused once the invitation was shared or opened or the guest answered.

## Phases

0 setup · 1 foundation · 2 guest management · 3 guest experience · 4 check-in ·
5 pilot messaging · 6 reports · 7 platform admin · 8 hardening and real pilot.
Official WhatsApp integration comes after provider selection.

Acceptance targets: in phase 4, 6 scanners admit 500 guests in 30 minutes. In phase 8, a real
event runs end to end with no paper guest list and no WhatsApp API.
