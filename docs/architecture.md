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

## Phases

0 setup · 1 foundation · 2 guest management · 3 guest experience · 4 check-in ·
5 pilot messaging · 6 reports · 7 platform admin · 8 hardening and real pilot.
Official WhatsApp integration comes after provider selection.

Acceptance targets: in phase 4, 6 scanners admit 500 guests in 30 minutes. In phase 8, a real
event runs end to end with no paper guest list and no WhatsApp API.
