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

Implementation choices made in phase 3, approved on 2026-09-28 with the follow-ups below.

- Invitation, RSVP, pass and design are separate tables (`invitations`, `rsvps`, `guest_passes`,
  `invitation_designs`, plus `message_templates` for the share text). Each guest gets one
  invitation and one `pending` RSVP when it is created; migration 0004 backfills existing guests.
- Invitation and pass tokens are 22 random base62 characters (about 131 bits), separate from each
  other, and never logged. The link is `/i/<token>` with no id or phone in it. Rotating a link
  replaces the token at once.
- Token storage (phase 3 follow-up, migration 0005): tokens are bearer credentials, so the
  database never holds them in plain text. Each row keeps `token_hash` (SHA-256, unique, used for
  every lookup: the guest page, RSVP, open beacon and the scanner's pass lookup) and `token_enc`
  (AES-256-GCM with `APP_ENCRYPTION_KEY`, with the row kind and id as associated data, so a
  ciphertext copied to another row fails to decrypt). A token is decrypted only to build the
  owner's link, the share text or export, or a valid pass's QR, and the decrypted value must
  hash back to `token_hash`. A plain hash needs no key because the tokens are random; an HMAC
  would add nothing. Rotation and replacement write a new hash and ciphertext. Losing
  `APP_ENCRYPTION_KEY` means links and QR codes can't be shown again (lookups keep working, and
  rotating or replacing issues new ones); a leaked key plus a database copy exposes the tokens, as
  it would the admin TOTP secrets. Key rotation is not built yet (one key; hardening phase).
  Migration: the runner (`packages/db/src/migrate.ts`) encrypts existing tokens with the key just
  before 0005 runs; 0005 moves the ciphertext into place, refuses to continue if any row was
  missed, then drops the plain-text columns. Run it with `APP_ENCRYPTION_KEY` set whenever the
  database already has invitations.
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
  cancelled → cancellation notice, no pass; archived after completing → read-only like
  completed; archived after cancelling → the cancellation notice (approved: cancellation never
  collapses into completion).
- Sharing and the links export are allowed while the event is active or live (not in draft).
  The design and share text can be edited while the event is draft, active or live.
- Design: four templates (elegant, celebration, formal, minimal), one primary colour (custom
  colours must keep white text at 4.5:1 or more), title, message, seven show/hide switches.
  Cover and logo are JPEG/PNG/WebP, checked by content, re-encoded to WebP without metadata,
  stored in private object storage under random keys, and served through `/media/…` only once the
  event is published (the owner can see them earlier for the preview).
- Public pages: rate limits per client (a keyed hash of the IP, never the IP) and per link; a
  client that presents more than 30 unknown tokens in 15 minutes is blocked for the window.
  Responses are `private, no-store`, `noindex`, and `Referrer-Policy: origin`, so the token never
  leaves in a Referer header, to this site or any other. (`no-referrer` makes browsers send
  `Origin: null` on the no-JavaScript RSVP form, which Next's origin check rejects. Tested under
  `origin`: the no-JS form posts with the site's origin and is accepted; posts with another
  origin, `null`, or a look-alike host are rejected, and a same-origin replay is accepted.)
- Passes: no standalone revoke (approved). A compromised pass is replaced; a guest who shouldn't
  attend declines or is cancelled. Pass history is kept.
- Hard delete is refused once the invitation was shared or opened or the guest answered.

## Check-in (phase 4)

Implementation choices made in phase 4. Items marked _awaiting approval_ differ from the proposal
or fill a gap in it, and stay open until the product owner confirms them.

- Staff access: the owner (or a supervisor, from the scanner) sends a one-time link
  (`/s/<token>`, 128 random bits, stored as SHA-256 only). Opening it only shows who it is for,
  so link previews can't use it up; tapping Continue redeems it on that device and sets an
  http-only, same-site strict `gp_staff` cookie holding the device session secret (also stored
  hashed). A second tap or device sees "already used" with no names. Sending a new link closes
  the open one and signs that member's devices out; removing a member does the same.
- Staff session validity is derived on every request, not stored: the session is valid while it
  is not ended, the member is not removed, and the event is `active` or `live` and not disabled.
  Completing the event ends every door session at once; reopening restores them. The cookie
  itself lasts at most 7 days. (The proposal had a stored `expires_at`.) _Awaiting approval._
- Door capabilities: every door member scans and admits; the owner and supervisors also
  correct counts, register walk-ins, confirm unanswered guests at the door and resend or stop
  colleagues' access. Staff see a guest's name, group, masked phone (`•••• 1234`) and party,
  never the full phone, email or notes; the walk-in duplicate warning is masked the same way.
- Admitting: the scanner reads `GP1.<token>` (the browser's QR detector where available,
  otherwise jsQR on camera frames) or finds the guest by name or phone. The card shows expected,
  inside and remaining; the door admits any number from 1 to the remaining party (partial
  arrival). A pass of another event reads as an unknown code; a replaced pass is refused with a
  hint to open the invitation for the current one.
- Every tap carries a client idempotency key made when the button is pressed. Writes take an
  advisory lock on the key and replay the earlier result if it was already applied, so a retry
  after a lost connection never admits twice. The scanner does not admit offline: on a lost
  connection it keeps the pending tap and offers Retry with the same key. _Awaiting approval._
- The database enforces the ledger (`check_in_logs`, append-only): the `apply_check_in` trigger
  checks the event state, the running count and the party size, requires an active pass for QR
  check-ins, and updates the `attendance` projection, which nothing else may write.
- Corrections are new ledger rows with a reason (never edits): owner and supervisors while
  `live`; the owner alone after completion, within the reopen window. The count stays between 0
  and the expected party. _Awaiting approval._
- Once anyone from a party is inside: the guest's own answer is locked (the invitation page says
  so), the owner can't lower the party below the count inside, the guest can't be cancelled or
  deleted, and a `live` event can't be cancelled.
- Confirm at the door changes only an unanswered guest to confirmed (within their allowance); a
  declined answer stays the owner's to change.
- Walk-ins are guests with source `walk_in`, phone optional, a confirmed answer and their whole
  party admitted in the same transaction. They are counted apart and never added to expected
  attendance. A phone already on the list shows the existing guests first.
- Load test (2026-09-29, one local server): 6 scanner phones admitted 500 confirmed guests
  (999 people) through the real scanner UI in 58 seconds; admit latency p50 289 ms, p95 335 ms,
  no errors, one ledger row per admission.

## Phases

0 setup · 1 foundation · 2 guest management · 3 guest experience · 4 check-in ·
5 pilot messaging · 6 reports · 7 platform admin · 8 hardening and real pilot.
Official WhatsApp integration comes after provider selection.

Acceptance targets: in phase 4, 6 scanners admit 500 guests in 30 minutes. In phase 8, a real
event runs end to end with no paper guest list and no WhatsApp API.
