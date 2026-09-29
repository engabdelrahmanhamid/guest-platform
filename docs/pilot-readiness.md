# Pilot readiness (phase 5)

Purpose: run one real, controlled event with the product as it is. Nothing here adds features. It
lists what is verified by code and tests, and what only people, real phones and real
infrastructure can verify. Each item has an owner and an evidence line to fill in.

## 1. Gates before the pilot event

| Gate                                                                      | How it is proven                                        | Status                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------- |
| Saudi-region staging and production exist, with separate databases        | Provider console; `pnpm pilot:check` on each            | Needs the hosting account |
| Managed PostgreSQL with point-in-time recovery                            | Provider setting; restore drill below                   | Needs the hosting account |
| Private S3-compatible bucket in the Saudi region                          | `pnpm pilot:check` (storage line)                       | Needs the hosting account |
| Transactional email provider, SPF/DKIM/DMARC on the sending domain        | `pnpm pilot:check --mail-to=…`, and the message arrives | Needs a provider decision |
| HTTPS with a valid certificate; HTTP redirects to HTTPS                   | `pnpm pilot:check --url=https://…`                      | Needs the domain          |
| Camera works on the deployed address (real iPhone Safari, Android Chrome) | Section 3 below                                         | Needs real phones         |
| Backup restored once from a real provider snapshot                        | Section 5 below                                         | Needs the hosting account |
| Monitoring and alerts wired                                               | Section 4 below                                         | Needs the hosting account |
| Full rehearsal with realistic data                                        | `REHEARSAL=1 pnpm test rehearsal` (done, see report)    | Done in code              |
| Security review of owner auth, staff sessions and tokens                  | Phase 5 report; findings fixed or accepted              | Done                      |
| Event-day checklists agreed with the person running the door              | Sections 6 and 7 below                                  | Needs the pilot organiser |

## 2. Environment

Copy `.env.example`; production needs `NODE_ENV=production`, `APP_BASE_URL` (https),
`DATABASE_URL`, `APP_ENCRYPTION_KEY` (keep an offline copy: losing it makes every stored guest link
unreadable), `STORAGE_DRIVER=s3` with the `S3_*` values, the `SMTP_*` values with `MAIL_FROM`, and
`TRUSTED_PROXY_HOPS`. Release steps are in `infrastructure.md`. After every release, run
`pnpm pilot:check`.

## 3. HTTPS and camera verification (real phones)

Browsers only give the camera to HTTPS pages, so this cannot be checked on a laptop's localhost.
On each device (iPhone Safari, Android Chrome; also one older phone if the door team owns any):

1. Open the staff link sent for a test event. Confirm it asks to sign in this device, then opens the
   scanner. Open the same link again: it must say the link was already used.
2. Allow the camera when asked. Scan a printed test QR (from the guest page) from about 30 cm.
   The guest card must appear within about two seconds.
3. Scan in bright sun and in a dim hall; with the screen at low brightness (guests show phones).
4. Deny the camera once and confirm the scanner explains how to allow it and search still works.
5. Turn on airplane mode: the scanner must say it is offline and admit nobody; turn it off and
   press retry: the guest is admitted once.
6. Lock the phone and return after five minutes: the device is still signed in.
7. Record device, OS and browser versions, and the result of each step, in section 8.

## 4. Monitoring and logging

What exists: `GET /api/health` (web) and `GET :8081/health` (worker) return up or down after a
database check and never include details; the worker logs a heartbeat every five minutes; every
log line is JSON with personal data, secrets and links redacted (verified by tests and by
`pnpm pilot:check`); the acceptance run confirmed server logs hold no link, session or pass secret.

To wire in the provider (needs the hosting account):

- Uptime check on `/api/health` every minute from outside the region; page the pilot lead after
  three failures.
- Alert when the worker heartbeat log line is missing for 15 minutes (the worker opens and closes
  check-in on schedule).
- Alert on 5xx rate above 2% for five minutes, and on database CPU, connections and free disk.
- Alert on backup age above 26 hours.
- If error tracking is used, set `ERROR_TRACKING_DSN` only for a provider hosted in the region, and
  send it nothing but the already redacted log fields. Guest personal data must never be sent.

## 5. Backup and restore drill

1. Run `SOURCE_DATABASE_URL=… scripts/restore-check.sh` against staging: it must print `OK`.
2. Restore a provider snapshot (or a point in time) into a new instance, run migrations with the
   production key (`infrastructure.md`), start the app against it, and open a live event: guest
   list, attendance totals and the ledger must match the source.
3. Record how long the restore took. That is the recovery time to tell the organiser.

## 6. Event-day connectivity checklist

The scanner needs a connection for every admission (offline admission is out of scope because two
offline phones could admit the same guest twice). Verify the venue before the day:

- [ ] Visit the venue at the event hour. At the door and inside the entrance, on the door team's
      own phones and networks, open `/api/health` and the scanner and admit a test guest.
- [ ] Signal is strong at the exact scanning spots, not only in the car park.
- [ ] Wi-Fi, if used, is for staff only, has no captive login page, and reaches the internet
      without a proxy that blocks the app's domain.
- [ ] Every scanner has mobile data as a second network, enough battery and a power bank.
- [ ] Two spare phones are signed in and charged (any supervisor can send a new staff link).
- [ ] Nothing else is streaming over the venue Wi-Fi at door opening.
- [ ] The door team knows what "no connection" looks like: the scanner says so and admits nobody;
      pressing retry when the signal returns admits the guest once.

## 7. Operational fallback checklist

| Situation                               | What the door team does                                                                                                                                                                                                             |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One phone loses signal                  | Move the guest to another scanner; retry on the first phone when the signal returns (same tap never admits twice)                                                                                                                   |
| All phones lose signal                  | Keep a printed list of expected guests (export from the owner's guest page before doors open); tick names on paper; when signal returns, admit them in the app by name so the ledger matches, with the supervisor confirming counts |
| Guest's QR will not scan                | Search by name or the last four digits of the phone; the card shows the party and how many are already inside                                                                                                                       |
| Guest has no phone or no link           | Search by name; supervisors may confirm an unanswered guest at the door                                                                                                                                                             |
| Someone shows a QR for another event    | The scanner reads it as unknown; search by name                                                                                                                                                                                     |
| Same QR shown twice                     | The second scan says the party is already inside and how many                                                                                                                                                                       |
| Guest says a different number of people | Admit those present; a supervisor or the owner corrects the count later, with a reason, as a new ledger row                                                                                                                         |
| A staff phone is lost or stolen         | Owner or a supervisor stops that person's access from the door team list (the phone is signed out at once) and sends a new link                                                                                                     |
| Unknown person, not on the list         | A supervisor registers a walk-in with the party size                                                                                                                                                                                |
| App is down (health check failing)      | Fall back to the paper list; the pilot lead contacts the operator; do not improvise a second system                                                                                                                                 |
| Owner needs to end door access entirely | Complete the event: every door device stops at once; reopen brings back only devices that were not stopped by hand                                                                                                                  |

Before doors open: check the door team list shows every person with a device signed in, admit one
test guest, and remove the test row by a correction with a reason if it stays in the ledger.

## 8. Device test record (fill in during the pilot preparation)

| Device / OS / browser | Link opens | Camera | Dim light | Denied camera | Offline banner | Notes |
| --------------------- | ---------- | ------ | --------- | ------------- | -------------- | ----- |
| iPhone / iOS / Safari |            |        |           |               |                |       |
| Android / Chrome      |            |        |           |               |                |       |
