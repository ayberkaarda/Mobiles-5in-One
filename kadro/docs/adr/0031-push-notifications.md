# ADR-0031: Push notifications — types, content, Expo delivery and the hourly cap

- Status: Accepted
- Date: 2026-10-01
- Deciders: Engineering (product spec §0.7), reported to Ayberk (owner)
- Related: product spec §3 story 8, §4 (push), §6 items 14, 22; ADR-0003, ADR-0004, ADR-0005,
  ADR-0028; threat model TB8, T-NOT-01..07

## Context

Story 8 requires reminders at T-24 h and T-2 h, RSVP change notifications to the captain and
open-call application notifications. Item 22 caps push fan-out at 5 000 sends per hour; the
`cost.guard` job that pauses non-critical sends is a Phase 6 deliverable. Notifications appear on
lock screens, so their text is visible to anyone near the phone.

## Decision

### Notification types (closed set, Phase 2)

| Type                   | Recipients                                 | Trigger                                                           |
| ---------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| `match.reminder_24h`   | RSVP `in` and `maybe`                      | `match.reminder` at `starts_at − 24 h`                            |
| `match.reminder_2h`    | RSVP `in`                                  | `match.reminder` at `starts_at − 2 h`                             |
| `match.updated`        | RSVP `in`, `maybe`, `waitlist`             | `starts_at` or venue changed, match cancelled (ADR-0004)          |
| `rsvp.changed`         | captain and co-captains                    | a participant's RSVP changes                                      |
| `rsvp.promoted`        | the promoted player                        | waitlist promotion                                                |
| `lineup.slot_free`     | captain                                    | a player leaves a `locked` match (ADR-0005)                       |
| `application.received` | captain and co-captains of the call's team | new application                                                   |
| `application.decided`  | applicant                                  | accepted, rejected, or rejected by call close / expiry (ADR-0003) |
| `team.member_joined`   | captain                                    | invite accepted                                                   |

There is **no broadcast push** for new open calls to nearby players in the MVP; free players find
calls by browsing. Every recipient is a user with an existing relationship to the object, so the
item 22 "open-call push radius cap" has no fan-out to cap. A broadcast feature needs its own ADR
with the cap.

### Content and privacy

- Title and body come from fixed Turkish templates in the worker (`users` has no locale column, so
  English variants wait until the profile stores a language). The only variable parts are the team name, the match date and time, and
  counts. Never another person's name, email, phone, message text, venue address or fee amount.
  Example: title "Maç yarın 21:00'de", body "Geliyor musun? Kadronu kontrol et."
- `data` carries only `{ type, matchId | teamId | openCallId | applicationId }` for the deep link.
  The app loads details through the API, where authorization applies.
- The payload is composed at send time from current data; a recipient who lost access (removed,
  match cancelled) is skipped.

### Removed members

A user removed from a team gets **no notification** about it: the closed type list has no such
type, and the worker skips a recipient who no longer holds the membership. When a member is
removed, the captain and co-captains receive `rsvp.changed` for the RSVPs affected, and a player
promoted from the waitlist as a result receives `rsvp.promoted`. A removal notice for the removed
user would need a new type and a membership check in reverse, so it is out of scope until a later
ADR asks for it.

### Delivery

- `push.send` payload: `{ type, userId, refId, idempotencyKey }`. One job per recipient; the
  handler sends to all of that user's `push_tokens` in one Expo request (up to 100 messages per
  request), with `EXPO_ACCESS_TOKEN` (enhanced push security enabled on the Expo project).
- Ticket errors: `DeviceNotRegistered` → delete that `push_tokens` row immediately;
  `MessageRateExceeded` → throw (retry with backoff); `MessageTooBig`, `InvalidCredentials` →
  complete, log and alert (configuration error).
- `push.receipts` runs 15 min later with `{ tickets: [{ ticketId, pushTokenId }] }` and calls
  Expo's receipt endpoint. `DeviceNotRegistered` → delete the token; other errors are logged with
  the metric `push_receipt_error{code}`.
- Tokens not seen for 60 days (`last_seen_at`, refreshed by `POST me/push-tokens` on app start)
  are removed by `maintenance.sweep`.
- Stale notifications are dropped: reminders after `starts_at`, every other type after 6 h.
- A worker restart between Expo's acceptance and job completion can repeat one notification;
  this at-least-once duplicate is accepted.

### Hourly cap (until `cost.guard`)

- Before each Expo request the handler increments a global counter in `rate_limit_buckets` (key
  `push:global`, 1-hour window) by the number of messages. Above `PUSH_HOURLY_CAP` (default 5 000)
  the job completes **without sending**, counted as `push_capped{type}`, with a warning log and an
  alert in preview and production.
- Dropping is preferred to delaying: a delayed reminder is wrong, and a burst that hits the cap is
  either abuse or a bug. Phase 6 `cost.guard` replaces this counter with daily caps per type and the
  pause switch; the counter key and metric names stay.

### Abuse limits at the source

- `rsvp.changed` is coalesced: at most one per match per captain or co-captain per 10 minutes
  (`singletonKey` = `rsvp:<matchId>:<recipientId>` with a 10-minute `startAfter`, the handler
  summarises the latest state).
- `application.received` is coalesced the same way per call and recipient.
- Coalescing key and delivery key differ: the `singletonKey` above only drops repeats while a job
  is queued or active; the job's `idempotencyKey` (the worker's receipt key) is
  `<singletonKey>:<windowOpenedEpochMilliseconds>`. A window opens with the first event that finds
  no queued or active job and ends when that job has run, so the next event after a delivery opens
  a new window and is sent instead of being dropped as a duplicate for the 30-day receipt lifetime.
- Producers are bounded by the API rate limits (groups O, C, G); a single user cannot cause more
  pushes than their mutations allow.

### Configuration

`PUSH_TRANSPORT` = `log` | `expo` (`log` only with `APP_ENV=local`, same rule as email),
`EXPO_ACCESS_TOKEN` (required for `expo`, on the secret rotation list), `PUSH_HOURLY_CAP`.

## Consequences

- Lock-screen text never discloses other people's data; T-NOT-02 holds by construction.
- Invalid tokens are pruned from both tickets and receipts; storage of dead tokens is bounded.
- One counter row per hour; no new table. Handoffs: `decisions-to-worker-001`,
  `decisions-to-config-001`, `decisions-to-contracts-001` (notification type enum, push-token
  schema).

## Rejected alternatives

- **Batch multiple users per `push.send` job.** Saves jobs but makes one bad token or one revoked
  relationship fail or delay the whole batch; per-user jobs keep retries and authorization local.
- **Queue capped notifications for the next hour.** Turns reminders into wrong information and
  keeps the overload going.
- **Personalised text ("Ali başvurdu").** Discloses names on lock screens of shared or lost
  devices.
