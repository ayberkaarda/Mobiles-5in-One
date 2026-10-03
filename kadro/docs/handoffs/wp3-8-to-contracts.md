# Handoff mobile deep links and push → contracts

- From: mobile deep links and push notifications (`apps/mobile/src/notifications/**`, ADR-0075)
- To: owner of `packages/contracts` (`jobs.ts`, open-call endpoints) and the worker push templates
  (`apps/worker/src/push/templates.ts`)
- Status: resolved with option 1 (ADR-0079): application notifications carry
  `{ type, applicationId, matchId }`

## A tapped application notification cannot open its screen

ADR-0031 puts only `{ type, applicationId }` in the `data` of `application.received` (captain and
co-captains) and `application.decided` (applicant). The app has no screen keyed by an application
id, and the contracts have no read that turns an application id into its open call or match:

- `GET open-calls/:id/applications` needs the call id;
- the staff call screen (`/ilan/mac/<matchId>`) needs the match id;
- the call screen (`/ilan/<id>`) reads the call from the list cache (there is no single-call read,
  ADR-0052).

Until one of the options below exists, the app opens the matches tab for `application.received`
and the Eksik Var tab for `application.decided` (`notificationHref` in
`apps/mobile/src/notifications/routing.ts`).

Request (either option is enough; the first needs no new endpoint):

1. Add the match id to the `data` of both application types, next to `applicationId`:
   `{ type, applicationId, matchId }`. The captain's tap opens `/ilan/mac/<matchId>` (staff view
   with the applications); an accepted applicant's tap opens the match through `GET matches/:id`
   (guest projection), a rejected one falls back to the Eksik Var tab when that read is refused. This needs a
   second id on `push.send` (or a lookup in the handler from `refId`) and an update of the
   `PUSH_REF_KEY` comment in ADR-0031.
2. A read `GET /api/v1/me/applications/:id` returning `{ id, status, openCallId, matchId }` for the
   applicant and the call's team staff only (404 for anyone else, same as an unknown id).

Nothing else in a notification changes: no names, no message text (ADR-0031 content rules).

Acceptance: the chosen field or endpoint is in the contracts and the OpenAPI document; the mobile
`parseNotificationData` test is extended with the new key; a tap on either application
notification opens the call or match screen instead of a tab.
