# Kadro — Authorization Matrix

|                 |                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status          | **Phase 1 baseline, extended with the Phase 2 domain decisions and the Phase 3-5 surface** (`GET me/stats`, `GET districts`, the RevenueCat webhook, the 15 admin operations). Normative for `packages/auth/src/policies.ts` and its table-driven tests. Rows added in Phase 2 carry `(P2)` after the endpoint, later rows `(P3)` and `(P5)`. Decisions in ADR-0003..0041, ADR-0063..0068 and ADR-0079. |
| Spec references | Product spec §5 (data model + API surface), §6 items 3, 4, 5, 7, 12, 17, 18, 21                                                                                                                                                                                                                                                                                                                         |
| Decisions       | `docs/adr/0003` … `docs/adr/0041`; Phase 3-5: `docs/adr/0063` … `docs/adr/0068`, `docs/adr/0079`                                                                                                                                                                                                                                                                                                        |
| Code mirror     | `packages/auth/src/policies.ts` (`can(actor, action, resource, options)`), `apps/web/tests/security/idor.test.ts`, `apps/web/tests/attack/**` (see `attack-report.md`)                                                                                                                                                                                                                                  |
| Change rule     | Any change to a cell here must ship together with the matching change in `policies.ts` and its test row. The document and the code must never disagree.                                                                                                                                                                                                                                                 |

---

## 1. Principals and roles

Two independent role axes exist. A request is evaluated against **both**: the platform role of the user and the relationship of the user to the target resource.

### 1.1 Platform roles (`users.role`)

| Matrix column | Policy role | Source of truth                                                                                                                                                                                                                               | Notes                                                                                                                                                                                                  |
| ------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **anon**      | `guest`     | No valid access JWT / session cookie                                                                                                                                                                                                          | Public read endpoints and auth entry points only.                                                                                                                                                      |
| **user**      | `user`      | Valid access JWT (`x-kadro-client: mobile`) or `__Host-kadro_session` (`x-kadro-client: web`), each accepted only on its own client type (ADR-0014); `users.deactivated_at IS NULL`, checked against the database on every request (ADR-0012) | Has no relationship to the target resource. Many write actions additionally require `email_verified_at IS NOT NULL` (marked **V**).                                                                    |
| **mod**       | `moderator` | `users.role = 'moderator'`                                                                                                                                                                                                                    | Moderation powers exist **only** under `/api/v1/admin/**` and only with a valid TOTP step-up. On every other endpoint a moderator is evaluated exactly like a `user` with the same team relationships. |
| **admin**     | `admin`     | `users.role = 'admin'`                                                                                                                                                                                                                        | Same rule as moderator: no implicit override on team, match, or profile endpoints. Extra powers: role management, venue import.                                                                        |

Decision (ADR-0007): **platform staff never bypass team-level policies on the regular API.** Every staff intervention goes through `/admin/**`, is TOTP-gated and audited. This keeps the regular API matrix small, testable and free of "god mode" branches.

The platform role is read from `users.role` on every request, never from token claims, so a demotion takes effect on the next request (ADR-0012).

### 1.2 Team relationship roles (`team_members.role`)

The task brief names these "team owner / team admin / team member"; the data model names them as follows.

| Matrix column | `team_members.role` | Brief name  | Invariant                                                                                                                               |
| ------------- | ------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **cap**       | `captain`           | team owner  | Exactly one per team (partial unique index). `teams.owner_id` equals the captain's `user_id` at all times (same transaction, ADR-0008). |
| **co**        | `co_captain`        | team admin  | Zero or more.                                                                                                                           |
| **ply**       | `player`            | team member | Zero or more.                                                                                                                           |

### 1.3 Derived relationships (computed per request, never sent by the client)

| Name               | Definition (server-side predicate)                                                                                                                                                                            | Used by                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **self**           | `actor.userId === target.userId`                                                                                                                                                                              | `me`, RSVP, member leave, application withdraw                                       |
| **member(T)**      | row exists in `team_members(team_id = T, user_id = actor)`                                                                                                                                                    | all team-scoped endpoints                                                            |
| **staff(T)**       | `member(T)` with role in (`captain`, `co_captain`)                                                                                                                                                            | team management                                                                      |
| **guest(M)**       | row exists in `match_rsvps(match_id = M, user_id = actor)` **and** not `member(M.team_id)` — a free player accepted through an open call, or a former member on a `played` match they took part in (ADR-0005) | match read, RSVP, MVP vote                                                           |
| **participant(M)** | `member(M.team_id)` or `guest(M)`                                                                                                                                                                             | match read                                                                           |
| **played(M)**      | `match_rsvps.status = 'in'` for actor on M                                                                                                                                                                    | MVP vote, payment target                                                             |
| **applicant(A)**   | `open_call_applications.user_id = actor` for application A                                                                                                                                                    | application read, withdraw                                                           |
| **author(R)**      | `venue_reviews.user_id = actor`                                                                                                                                                                               | review visibility of own content                                                     |
| **creator(V)**     | `venues.created_by = actor`                                                                                                                                                                                   | unverified venue visibility                                                          |
| **stepUp**         | server-side step-up record for the actor's session / refresh family with `step_up_until > now()`                                                                                                              | all `/admin/**` except `admin/step-up`, `admin/totp/enroll` and `admin/totp/confirm` |
| **pro**            | a `subscriptions` row of the actor with status `active` or `grace_period` and `expires_at` null or later than `now()` (server-side, ADR-0065)                                                                 | entitlement gates (section 7)                                                        |

The matrix column **gst** below refers to `guest(M)`.

---

## 2. Response semantics (applies to every cell)

| Situation                                                                                                                                                                                                              | Status              | Problem `code`                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------ |
| No / invalid / expired credentials on a protected endpoint                                                                                                                                                             | 401                 | `unauthenticated`                                                              |
| Account deactivated (deletion grace or admin action), on **every** protected endpoint incl. reads; `deactivated_at` is read from the database per request, so the 15-min access JWT lifetime gives no grace (ADR-0012) | 401                 | `account_deactivated`                                                          |
| Actor has **no read relationship** to the resource (non-member asks for a team, match, application)                                                                                                                    | **404**             | `not_found` — identical body to a truly missing id, so existence is not leaked |
| Actor can read the resource but lacks the action permission (player tries to edit a match)                                                                                                                             | 403                 | `forbidden`                                                                    |
| Email not verified on a **V** action                                                                                                                                                                                   | 403                 | `email_unverified`                                                             |
| Admin route without valid step-up (all admin routes except `admin/step-up`, `admin/totp/enroll` and `admin/totp/confirm`)                                                                                              | 401                 | `step_up_required`                                                             |
| Wrong, reused or out-of-window TOTP code (step-up, enrollment confirm, the per-action code of a role change or deactivation)                                                                                           | 401                 | `totp_invalid`                                                                 |
| TOTP not enrolled (step-up, or confirm without a live pending secret) / already enrolled (enroll, confirm)                                                                                                             | 409                 | `totp_not_enrolled` / `totp_already_enrolled`                                  |
| Non-staff on admin route                                                                                                                                                                                               | 403                 | `forbidden`                                                                    |
| Entitlement missing (free-tier limit, `is_pro_locked` team, captaincy transfer to a free owner) — the **only** status used for entitlements (ADR-0013)                                                                 | 403                 | `entitlement_required`                                                         |
| Allowed by policy but invalid state (match locked, call expired, duplicate)                                                                                                                                            | 409                 | `conflict` / specific code                                                     |
| Body / query / params fail zod `.strict()`                                                                                                                                                                             | 400                 | `validation_failed`                                                            |
| Body above 1 MB (checked before parsing) / wrong `Content-Type` (ADR-0022)                                                                                                                                             | 413 / 415           | `payload_too_large` / `unsupported_media_type`                                 |
| Rate limit hit                                                                                                                                                                                                         | 429 + `Retry-After` | `rate_limited`                                                                 |

**Evaluation order in every Route Handler** (Phase 1 handler template):

1. Read `x-kadro-client` (missing / unknown, or `mobile` with an `Origin` header → 400; exempt: `GET health`, `POST webhooks/revenuecat`, ADR-0020) and authenticate with that client's transport only: bearer JWT for `mobile`, session cookie + CSRF on mutations for `web` (ADR-0014). Then load the user row by primary key (`role`, `email_verified_at`, `deactivated_at`) together with the active row of the token's session family (`sid`) → `ActorContext`. Deactivated → 401 `account_deactivated` (ADR-0012); revoked or expired family → 401 `unauthenticated` (ADR-0025).
2. Parse and validate params / query / body with the `packages/contracts` schema.
3. Rate-limit check for the endpoint group (section 8).
4. Load the resource addressed by the URL **through its read-scoped query** (section 5), never by bare id. Not found → 404.
5. `authorize(can(actor, action, resource))` → 403 when readable but not allowed.
6. For nested path targets (`:userId` of a payment, `:userId` of a member, `:appId` of a call), load the target **inside the already authorized parent**. Not found → 404. User ids inside a lineup body are not path targets; ids without an `in` RSVP on the match fail the state check in step 7 (409 `lineup_invalid_player`).
7. State preconditions (409).
8. Mutate in a transaction; write `audit_logs` where required.

Steps 4–6 are mandatory even when the mobile UI already hides the control (§6 item 4). The order guarantees that a readable-but-forbidden request is always 403 and an unreadable one always 404, never the other way around because of how a query happens to be scoped (ADR-0013).

---

## 3. Endpoint × role matrix

Legend: **Y** allowed · **Y·V** allowed only with verified email · **self** only for the actor's own row · **401 / 403 / 404 / 409** result for that actor · **rel** evaluate with the actor's team relationship (staff get no override) · footnote numbers refer to section 3.9.

Columns: `anon` · `user` (authenticated, no relationship) · `ply` · `co` · `cap` · `gst` (match guest) · `mod` · `admin`.

### 3.1 Auth (`/api/v1/auth/*`)

| Endpoint                 | Policy action      | anon | user | ply / co / cap / gst | mod  | admin | Notes                                                                                                                                                              |
| ------------------------ | ------------------ | ---- | ---- | -------------------- | ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST auth/register`     | `auth.register`    | Y    | Y    | n/a                  | Y    | Y     | Rate limit A. Always 202 with an identical body and no session; existing email gets an "already registered" email instead; Argon2id runs on both paths (ADR-0015). |
| `POST auth/login`        | `auth.login`       | Y    | Y    | n/a                  | Y    | Y     | Rate limit A (IP **and** email). Generic `invalid_credentials`; constant-time verify incl. dummy hash for unknown emails.                                          |
| `POST auth/refresh`      | `auth.refresh`     | Y¹   | Y¹   | n/a                  | Y¹   | Y¹    | Possession of a valid, unrevoked, unexpired refresh token. Reuse of a rotated token revokes the whole family.                                                      |
| `POST auth/logout`       | `auth.logout`      | 401  | self | n/a                  | self | self  | Revokes the presented token's family (mobile) or session row (web); access tokens with that `sid` fail from the next request (ADR-0025).                           |
| `POST auth/verify-email` | `auth.verifyEmail` | Y²   | Y²   | n/a                  | Y²   | Y²    | Token possession; single use (`used_at`).                                                                                                                          |
| `POST auth/forgot`       | `auth.forgot`      | Y    | Y    | n/a                  | Y    | Y     | Always 202 with an identical body, no account enumeration (ADR-0015).                                                                                              |
| `POST auth/reset`        | `auth.reset`       | Y²   | Y²   | n/a                  | Y²   | Y²    | On success revoke **all** refresh tokens and sessions of the user.                                                                                                 |
| `POST auth/apple`        | `auth.apple`       | Y³   | Y³   | n/a                  | Y³   | Y³    | Identity token verified against Apple JWKS, `aud`, `iss`, nonce.                                                                                                   |
| `POST auth/google`       | `auth.google`      | Y³   | Y³   | n/a                  | Y³   | Y³    | ID token verified against Google JWKS, `aud` in allowed client ids.                                                                                                |

### 3.2 Self (`/api/v1/me*`)

| Endpoint              | Policy action        | anon | user (any)      | mod                    | admin                   | Notes                                                                                                                                                                                                                    |
| --------------------- | -------------------- | ---- | --------------- | ---------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET me`              | `me.read`            | 401  | self            | self                   | self                    | Returns own profile incl. own email and `entitlements` (`{ pro, status, expiresAt, store }`, always present, ADR-0065, ADR-0079); never `password_hash`, `totp_secret_enc`, provider subs.                               |
| `PATCH me`            | `me.update`          | 401  | self            | self                   | self                    | Field allow-list in section 4.1. `role` and `avatar_key` are never writable here; `avatar: null` removes the avatar (ADR-0030).                                                                                          |
| `DELETE me`           | `me.delete`          | 401  | self + re-auth⁴ | self + re-auth⁴ + TOTP | self + re-auth⁴ + TOTP⁵ | Starts deletion (§6 item 21, ADR-0032): 202 `{ graceUntil }`; pending request → 409 `deletion_pending`; rate limit D. There is no cancel endpoint: a successful sign-in during the grace period cancels (ADR-0012).      |
| `POST me/push-tokens` | `pushToken.register` | 401  | self            | self                   | self                    | `user_id` taken from session. An `expo_token` already bound to another user is re-bound to the actor (device changed hands); the old binding is deleted, not shared.                                                     |
| `GET me/stats` (P3)   | `me.read`            | 401  | self            | self                   | self                    | Matches played and MVP count for everyone; the `advanced` block only while the caller holds Pro at request time, read from `subscriptions` on the server, never from a client claim (§7, ADR-0065). No rate-limit group. |

### 3.3 Teams, invites, members

| Endpoint                                  | Policy action       | anon | user      | ply   | co                       | cap              | gst                      | mod / admin |
| ----------------------------------------- | ------------------- | ---- | --------- | ----- | ------------------------ | ---------------- | ------------------------ | ----------- |
| `GET teams`                               | `team.list`         | 401  | Y (empty) | Y     | Y                        | Y                | Y (own memberships only) | rel         |
| `POST teams`                              | `team.create`       | 401  | Y·V⁶      | Y·V⁶  | Y·V⁶                     | Y·V⁶             | Y·V⁶                     | rel         |
| `GET teams/:id`                           | `team.read`         | 401  | 404       | Y     | Y                        | Y                | 404                      | rel         |
| `PATCH teams/:id`                         | `team.update`       | 401  | 404       | 403   | Y                        | Y                | 404                      | rel         |
| `DELETE teams/:id`                        | `team.delete`       | 401  | 404       | 403   | 403                      | Y³⁴              | 404                      | rel         |
| `POST teams/:id/invites`                  | `invite.create`     | 401  | 404       | 403   | Y·V²⁹                    | Y·V²⁹            | 404                      | rel         |
| `GET teams/:id/invites` (P2)              | `invite.list`       | 401  | 404       | 403   | Y²⁹                      | Y²⁹              | 404                      | rel         |
| `DELETE teams/:id/invites/:inviteId` (P2) | `invite.revoke`     | 401  | 404       | 403   | Y²⁹                      | Y²⁹              | 404                      | rel         |
| `GET invites/:code` (P2, preview)         | `invite.preview`    | Y²⁸  | Y²⁸       | Y²⁸   | Y²⁸                      | Y²⁸              | Y²⁸                      | Y²⁸         |
| `POST invites/:code/accept`               | `invite.accept`     | 401  | Y·V⁷      | 409   | 409                      | 409              | Y·V⁷                     | rel         |
| `PATCH teams/:id/members/:userId`         | `member.updateRole` | 401  | 404       | 403   | 403                      | Y⁸               | 404                      | rel         |
| `DELETE teams/:id/members/:userId`        | `member.remove`     | 401  | 404       | self⁹ | self or target `player`⁹ | any except self⁹ | 404                      | rel         |

### 3.4 Matches, RSVP, lineup, payments, MVP

| Endpoint                             | Policy action  | anon | user | ply    | co     | cap    | gst                    | mod / admin |
| ------------------------------------ | -------------- | ---- | ---- | ------ | ------ | ------ | ---------------------- | ----------- |
| `GET teams/:id/matches`              | `match.list`   | 401  | 404  | Y      | Y      | Y      | 404                    | rel         |
| `POST teams/:id/matches`             | `match.create` | 401  | 404  | 403    | Y¹⁰    | Y¹⁰    | 404                    | rel         |
| `GET matches/:id`                    | `match.read`   | 401  | 404  | Y      | Y      | Y      | Y (guest projection¹¹) | rel         |
| `PATCH matches/:id`                  | `match.update` | 401  | 404  | 403    | Y¹²    | Y¹²    | 403                    | rel         |
| `DELETE matches/:id`                 | `match.delete` | 401  | 404  | 403    | Y¹³    | Y¹³    | 403                    | rel         |
| `PUT matches/:id/rsvp`               | `rsvp.set`     | 401  | 404  | self¹⁴ | self¹⁴ | self¹⁴ | self¹⁴                 | rel         |
| `PUT matches/:id/lineup`             | `lineup.set`   | 401  | 404  | 403    | Y¹⁵    | Y¹⁵    | 403                    | rel         |
| `PATCH matches/:id/payments/:userId` | `payment.mark` | 401  | 404  | 403    | Y¹⁶    | Y¹⁶    | 403                    | rel         |
| `POST matches/:id/mvp-vote`          | `mvp.vote`     | 401  | 404  | Y¹⁷    | Y¹⁷    | Y¹⁷    | Y¹⁷                    | rel         |

### 3.5 Open calls (Eksik Var) and applications

| Endpoint                                                             | Policy action          | anon                    | user                     | ply | co  | cap | gst                      | mod / admin |
| -------------------------------------------------------------------- | ---------------------- | ----------------------- | ------------------------ | --- | --- | --- | ------------------------ | ----------- |
| `GET open-calls?district=&level=&position=`                          | `opencall.list`        | Y (public projection¹⁸) | Y                        | Y   | Y   | Y   | Y                        | rel         |
| `POST matches/:id/open-call`                                         | `opencall.publish`     | 401                     | 404                      | 403 | Y¹⁹ | Y¹⁹ | 403                      | rel         |
| `PATCH matches/:id/open-call` (P2, `status: 'closed'`)               | `opencall.close`       | 401                     | 404                      | 403 | Y³⁰ | Y³⁰ | 403                      | rel         |
| `POST open-calls/:id/applications`                                   | `application.create`   | 401                     | Y·V²⁰                    | 409 | 409 | 409 | 409                      | rel         |
| `PATCH open-calls/:id/applications/:appId` (`accepted` / `rejected`) | `application.decide`   | 401                     | 404; applicant 403²¹     | 404 | Y²¹ | Y²¹ | 404                      | rel         |
| `PATCH open-calls/:id/applications/:appId` (`withdrawn`)             | `application.withdraw` | 401                     | 404; applicant self²²    | 404 | 403 | 403 | 404                      | rel         |
| `GET open-calls/:id/applications` (P2)                               | `application.list`     | 401                     | 404; applicant own row³³ | 404 | Y³³ | Y³³ | 404; applicant own row³³ | rel         |

"ply / co / cap" in this table means a member of the team that owns the call's match. Applications are readable only by the applicant and the call's team staff (section 6), so team players and match guests have no read relationship → 404; the applicant can read their own application but cannot decide it → 403; staff can read it but cannot withdraw it → 403 (ADR-0013). A `gst` who is also the applicant is evaluated as the applicant.

### 3.6 Venues (Saha Rehberi) and reviews

| Endpoint                                | Policy action      | anon | user   | mod  | admin | Notes                                                                                                                                 |
| --------------------------------------- | ------------------ | ---- | ------ | ---- | ----- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET venues?district=&q=`               | `venue.list`       | Y    | Y      | Y    | Y     | Verified + sample venues for everyone; unverified venues only to their creator (`creator(V)`).                                        |
| `GET venues/:slug`                      | `venue.read`       | Y    | Y      | Y    | Y     | Unverified venue → 404 for everyone except its creator. Unverified venues are excluded from sitemap and SEO pages.                    |
| `POST venues`                           | `venue.create`     | 401  | Y·V²³  | Y·V  | Y·V   | Always created with `verified = false`, `is_sample = false`, `created_by = actor`.                                                    |
| `POST venues/:slug/reviews`             | `review.create`    | 401  | Y·V²⁴  | Y·V  | Y·V   | Only after playing a `played` match at this venue, else 403 `review_not_eligible`; second review → 409 `already_reviewed` (ADR-0038). |
| `DELETE venues/:slug/reviews/mine` (P2) | `review.deleteOwn` | 401  | self³² | self | self  | Removes the actor's own review; no effect on others' reviews.                                                                         |

### 3.7 Uploads, webhooks

| Endpoint                                       | Policy action                                  | anon              | user   | ply  | co   | cap  | mod / admin | Notes                                                                                                                                                                                                      |
| ---------------------------------------------- | ---------------------------------------------- | ----------------- | ------ | ---- | ---- | ---- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST uploads/presign` `kind=avatar`           | `upload.presign.avatar`                        | 401               | Y      | Y    | Y    | Y    | rel         | Keys generated server-side: incoming `incoming/avatar/{actorId}/{uploadId}`, published `avatars/{actorId}/{uploadId}.webp` (ADR-0030). Rate limit U.                                                       |
| `POST uploads/presign` `kind=badge` + `teamId` | `upload.presign.badge`                         | 401               | 404    | 403  | Y    | Y    | rel         | Keys: `incoming/badge/{teamId}/{uploadId}`, `badges/{teamId}/{uploadId}.webp`. Membership checked on `teamId`; re-checked by the worker before applying (`not_allowed`).                                   |
| `POST uploads/:id/complete` (P2)               | `upload.complete`                              | 401               | self³¹ | self | self | self | self        | Uploader only; others 404. Enqueues `upload.process`.                                                                                                                                                      |
| `GET uploads/:id` (P2)                         | `upload.read`                                  | 401               | self³¹ | self | self | self | self        | Uploader only; others 404. Status, reject reason, public URL when ready.                                                                                                                                   |
| `POST webhooks/revenuecat`                     | `webhook.revenuecat`                           | Y²⁵ (secret only) | —      | —    | —    | —    | —           | No user principal. Cookies / bearer tokens on this route are ignored, never used to authenticate. Not CORS-enabled. Always 200 `accepted` / `duplicate` / `ignored` once the secret matched (footnote 25). |
| `GET districts` (P3)                           | none (public reference data, no policy action) | Y                 | Y      | Y    | Y    | Y    | Y           | Provinces and districts with slugs and centroids; `x-kadro-client` still required, no principal, no rate-limit group, `no-store` like every API response.                                                  |
| `GET health`                                   | `health.read` (not a policy action)            | Y                 | Y      | Y    | Y    | Y    | Y           | Exempt from `x-kadro-client` (ADR-0020). Reads no credentials; returns status and build SHA only; `Cache-Control: no-store`.                                                                               |

### 3.8 Admin (`/api/v1/admin/**` and web `/admin/**`)

The admin surface is the 15 operations of ADR-0064 (registry phase 5, handlers in `apps/web/app/api/v1/admin/**`, behaviour in ADR-0066 and ADR-0067). Every row requires `mod` or `admin` **and** a valid step-up, **with exactly three exceptions**: `POST admin/step-up`, `POST admin/totp/enroll` and `POST admin/totp/confirm`, which are the routes that establish the step-up and therefore require only an authenticated staff session (enrollment additionally requires re-auth⁴; step-up requires an enrolled secret, else 409 `totp_not_enrolled`; confirm activates the pending secret and does not open a step-up window). Rows marked "admin" in the policy tier need the `admin` role: a moderator with a valid step-up gets 403. Every mutation, including a successful or failed step-up and an enrollment, writes `audit_logs` (actor, action, target, no PII in `metadata`, the audit list never exposes `ip_hash`) (ADR-0007, ADR-0067). Lists use the cursor pagination of ADR-0039; users appear with a masked email only.

| Endpoint                                              | Policy action           | anon | user / any team role | mod without stepUp                  | mod + stepUp | admin without stepUp | admin + stepUp |
| ----------------------------------------------------- | ----------------------- | ---- | -------------------- | ----------------------------------- | ------------ | -------------------- | -------------- |
| `POST admin/step-up` (verify TOTP code)               | `admin.stepUp`          | 401  | 403                  | Y²⁶                                 | Y            | Y²⁶                  | Y              |
| `POST admin/totp/enroll`                              | `admin.totpEnroll`      | 401  | 403                  | Y (re-auth⁴, only if no secret yet) | Y            | Y (same)             | Y              |
| `POST admin/totp/confirm`                             | `admin.totpEnroll`      | 401  | 403                  | Y (only with a pending secret)      | Y            | Y (same)             | Y              |
| `GET admin/venues`                                    | `admin.read`            | 401  | 403                  | 401 `step_up_required`              | Y            | 401                  | Y              |
| `PATCH admin/venues/:id` (`verified`, corrections)    | `venue.verify`          | 401  | 403                  | 401                                 | Y            | 401                  | Y              |
| `POST admin/venues/import` (CSV → `venue.import` job) | `venue.import`          | 401  | 403                  | 401                                 | 403          | 401                  | Y              |
| `GET admin/venues/import/:importId`                   | `admin.read`            | 401  | 403                  | 401                                 | Y            | 401                  | Y              |
| `GET admin/reviews`                                   | `admin.read`            | 401  | 403                  | 401                                 | Y            | 401                  | Y              |
| `DELETE admin/reviews/:id`                            | `review.delete`         | 401  | 403                  | 401                                 | Y            | 401                  | Y              |
| `GET admin/open-calls`                                | `admin.read`            | 401  | 403                  | 401                                 | Y            | 401                  | Y              |
| `DELETE admin/open-calls/:id` (remove + hide)         | `opencall.remove`       | 401  | 403                  | 401                                 | Y            | 401                  | Y              |
| `GET admin/users`                                     | `admin.read`            | 401  | 403                  | 401                                 | Y            | 401                  | Y              |
| `PATCH admin/users/:id/role`                          | `admin.role.manage`     | 401  | 403                  | 401                                 | 403          | 401                  | Y²⁷            |
| `PATCH admin/users/:id/deactivate` (platform ban)     | `admin.user.deactivate` | 401  | 403                  | 401                                 | 403          | 401                  | Y²⁷            |
| `GET admin/audit-logs`                                | `admin.audit.read`      | 401  | 403                  | 401                                 | 403          | 401                  | Y              |

Rate limits: group T on the three TOTP routes (§8), group G on the mutations, none on the lists. Moderators may read an import's state (`admin.read`); only admins start one (ADR-0067). The mobile app has no admin screens; the web panel under `/admin/**` (ADR-0068) calls the same API with a web session and CSRF token.

### 3.9 Footnotes (conditions that the policy or handler must enforce)

1. Refresh token looked up by SHA-256 hash; must be unrevoked, unexpired, issued to the same client type (ADR-0014), and the newest in its rotation chain. There is no grace window: presenting a rotated token, or two concurrent uses of the same token, revokes every token of the same `family_id` and returns 401 (ADR-0019). A token presented over the other client type is rejected with 401 without revoking the family. A client that refreshes with a token already revoked by logout or reset also hits the reuse path and writes an `auth.refreshReuse` audit row; when the family was already revoked before that request, reviewers treat the row as a stale client, not as theft.
2. Email token by SHA-256 hash, matching `purpose`, unexpired, `used_at IS NULL`; marked used in the same transaction.
3. A provider `sub` that matches an existing account logs into that account. A provider token without an email cannot create an account (401 `token_invalid`); a provider `sub` different from the one already linked → 409 `account_link_required`; provider keys that cannot be fetched → 503 `service_unavailable` with `Retry-After`. Redeeming a password-reset link sets `email_verified_at` if it was null (it proves control of the mailbox). Linking a provider `sub` to an existing **password** account with the same email requires that email to be verified on both sides (provider `email_verified = true` and `users.email_verified_at` set); otherwise 409 `account_link_required`.
4. Re-auth = password re-entry (password accounts) or a fresh provider identity token (`iat` ≤ 5 min) for social-only accounts. Re-auth proof is single-use. `DELETE me` is rate-limited (group D) because it verifies a password.
5. Staff accounts must also pass TOTP so a stolen password alone cannot destroy a staff account and its audit trail. The **last remaining active admin** cannot start deletion (409 `last_admin`, ADR-0009).
6. Free tier: actor may **own** (captain) at most 1 team; owning a second requires `pro` (server-side entitlement, Phase 5), else 403 `entitlement_required`. Membership in other teams is unlimited.
7. Invite valid: `expires_at > now()`, `uses < max_uses`; `uses` incremented atomically (`UPDATE … SET uses = uses + 1 WHERE uses < max_uses RETURNING`). Actor joins as `player`. Already a member → 409 `already_participant`, checked before the increment so no use is consumed. Staff create invites with defaults 7 days / 20 uses, at most 10 live invites per team (409 `invite_limit`); the captain is notified by push (ADR-0034). Invalid / expired / exhausted codes all return the same 404 so codes cannot be probed for state. Codes carry 128 bits of CSPRNG randomness, are stored only as `team_invites.code_hash` (SHA-256) and looked up by hash; the plaintext is returned once at creation and masked in logs (ADR-0011).
8. Captain may set a member's role to `co_captain` or `player`. Setting `role = captain` is a **captaincy transfer**: in one transaction holding a row lock on `teams`, the target becomes `captain`, the previous captain becomes `co_captain`, `teams.owner_id` is updated and an audit row `team.captaincyTransfer` is written. A free-tier target who already owns a team → 403 `entitlement_required`. Captain cannot change their own role except through transfer. Co-captains and players cannot change roles (403; prevents co-captain vs co-captain escalation) (ADR-0008).
9. Removal rules: any member may remove **self** (leave) except the captain, who must transfer captaincy or delete the team (409 `captain_must_transfer`; deletion is subject to footnote 34). Co-captain may remove only members whose role is `player`. Captain may remove anyone except self. Effects (removal and leave alike, one transaction): the membership row is deleted; the user's RSVPs on the team's matches in `draft`/`open`/`locked` status are deleted (waitlist promotion runs, captain notified for `locked`); `played` rows are kept for history. The kept `played` rows give the former member the guest projection of those matches only; team, roster and all other matches → 404 (ADR-0005).
10. Team must not be `is_pro_locked` (else 403 `entitlement_required`). `venue_id`, if present, must reference a venue readable by the actor. Ranges per §6 item 6.
11. Guest projection of a match: datetime, venue, format, own RSVP, lineup sides, per-player share, other participants' display name / avatar / position only. Guests do not see other players' `paid` flags or the team's other matches.
12. Writable fields in section 4.4. `fee_total_minor`, `slots`, `format` are writable only while `locked_at IS NULL` and `status ∈ {draft, open}`; `locked_at` is set server-side on the first `open→locked` transition and never cleared, so reopening does not unfreeze them (409 `match_terms_frozen`, ADR-0004). Allowed transitions: `draft→open`, `open→locked`, `locked→open`, `open|locked→played` (only after `starts_at`), `draft|open|locked→cancelled`. `played` and `cancelled` are terminal. Setting `played` sets `mvp_vote_closes_at = now() + 24h` server-side.
13. `draft` → hard delete. `open`/`locked` → treated as cancel (status `cancelled`, RSVPs notified). `played` → 409.
14. Actor writes only their own row (`user_id` from session, never from body). Allowed values `in | out | maybe`; `waitlist` is assigned by the server when `in` exceeds `slots`, ordered by the server-only `waitlisted_at`; promotion takes the oldest waitlisted row under a lock on the match (ADR-0035). Match must be `open` and not started; in `locked` only `out` is allowed (triggers waitlist promotion + captain notification). Guests are never waitlisted; a guest who went `out` cannot return to `in` unless slots are free. `side` and `paid` are not writable here.
15. Match loaded through the participant scope (non-participant → 404), then `lineup.set` checked (player / guest → 403). Every user id in the body must have `status = 'in'` on this match (else 409 `lineup_invalid_player`); each appears at most once; sides `A|B`; each side at most `ceil(slots / 2)` players (409 `lineup_side_full`); the body replaces the whole lineup. Match status `open` or `locked` (ADR-0035).
16. Match loaded through the participant scope (non-participant → 404), then `payment.mark` checked (player / guest → 403), then target `:userId` loaded inside the match (no RSVP → 404; RSVP not `in` → 409). Only `paid` is writable. Self-marking is allowed for the captain only; a co-captain targeting themselves → 403. Every call (set or clear) writes one `audit_logs` row in the same transaction; audit failure rolls back the update (ADR-0006). Allowed in `locked` and `played`.
17. Match `played`, `now() < mvp_vote_closes_at`, voter `played(M)`, votee `played(M)` on the same match, `votee ≠ voter`, one final vote per voter (unique → 409 `already_voted`; after the window 409 `mvp_vote_closed`). Tallies stay hidden until the window closes (ADR-0036).
18. Public projection: district, `starts_at`, format, missing count, position, level, venue name (verified venues) or district only (free-text venue), team name. No user names, no RSVP list, no fee breakdown, no exact address for free-text venues. Expired / closed / removed calls are excluded.
19. Match `open`, `starts_at > now()`, at most one open call with `status = open` per match (409 `open_call_exists`), `now() + 15 min ≤ expires_at ≤ starts_at`, `1 ≤ missing_count ≤ slots − confirmed`, team not `is_pro_locked`, rate limit C. No broadcast push to nearby players exists in the MVP; notifications go only to the call's staff and applicants (ADR-0031, ADR-0037).
20. Call `open` and `expires_at > now()`; match `open` and `starts_at > now()`; actor is not a member of the match's team and has no RSVP on the match; one application per user per call, enforced by the unique constraint `(open_call_id, user_id)` → 409 `already_applied` whatever the earlier application's status (ADR-0010); `message` ≤ 280 chars, rendered as text.
21. Application loaded by `app.id = :appId AND app.open_call_id = :id` joined to the call's match and team, scoped to applicant or staff (one query, never two independent lookups); not found → 404, applicant without staff role → 403. `accepted` runs in one transaction with row locks on match and call and requires: application `pending`, call `open` and unexpired, match `open` and `starts_at > now()`, applicant not a member and without RSVP, a free slot. Failures → 409 `application_not_pending` / `call_closed` / `match_not_open` / `already_participant` / `match_full`. Success creates an RSVP `in` and decrements `missing_count`; at 0 the call closes. `rejected` requires application `pending` and call `open` and unexpired. Closing a call by any write rejects its remaining `pending` applications in the same transaction (ADR-0003).
22. Applicant may set own `pending` application to `withdrawn`. Staff → 403; anyone else → 404.
23. Rate limit V (section 8). `phone` and `address` stored as given but shown publicly only after verification.
24. Actor has RSVP `in` on at least one `played` match whose `venue_id` is this venue, else 403 `review_not_eligible`; one review per user and venue (409 `already_reviewed`). Review text ≤ 500 chars, rendered through `rehype-sanitize` (web) / plain text (mobile); rating integer 1..5; rate limit W (ADR-0038).
25. The `Authorization` header is compared with `REVENUECAT_WEBHOOK_SECRET` before the body is read, either as the bare value or as `Bearer <value>`; both comparisons always run through `constantTimeEqual` (`packages/auth/src/tokens.ts`: HMAC-SHA-256 digests under a per-call random key, compared with `crypto.timingSafeEqual`). A missing or wrong header → 401 `unauthenticated`; no secret configured → 503 `service_unavailable` (fail closed). Past the gate every valid delivery answers **200** `{ status }`: `accepted` (new `event.id`, stored in `webhook_events`, `webhook.revenuecat.process` enqueued), `duplicate` (event id already stored, nothing enqueued) or `ignored` (stored, not applied: `TEST`, an unhandled event type, a missing, anonymous or unknown `app_user_id`, a product outside the Pro products, a missing environment). An unknown `app_user_id` is therefore **not** rejected with a 4xx: a rejection would only make RevenueCat retry an event that can never succeed (ADR-0063 decision 4). Tests: `apps/web/tests/billing/webhook.test.ts`, `apps/web/tests/attack/webhook-forgery.test.ts`.
26. TOTP verify (`admin/step-up`, `admin/totp/confirm` and the per-action code): 6 digits, ±1 step window, the same time step cannot be reused (last accepted step stored, consumed by one conditional update), a budget of 5 attempts / 15 min per user shared by every TOTP check of the account (ADR-0066). Success of `admin/step-up` creates a server-side step-up record valid 15 min bound to the current session id (web) or refresh-token family (mobile); enrollment confirmation stores its step but opens no window.
27. A fresh TOTP code is required in the request itself (body field `totpCode`; absent → 400 `validation_failed`, wrong, reused or out of window → 401 `totp_invalid` with an `admin.freshTotpFailed` audit row), on top of the 15-min window. The checks that cannot spend the code run first (staff role, step-up, admin tier, own account), so a refused request never consumes a TOTP step. Actor cannot change or deactivate **their own** account: **403 `forbidden`**, not 409. The last remaining active admin cannot be demoted or deactivated (409 `last_admin`, counted after locking all admin rows so concurrent demotions cannot both pass; two admins acting on each other serialize and the second gets 403). An unknown or tombstone target → 404. Lifting a deactivation while a self-initiated deletion is pending → 409 `deletion_pending`. Bootstrapping the first admin is done by an operator script against the database, never through the API, and writes an audit row (ADR-0009, ADR-0067).
28. Anonymous and signed-in callers alike, rate limit I. Returns team name, badge URL, district and member count only; invalid, expired, revoked and exhausted codes return the same 404 (ADR-0034).
29. Creating an invite requires a verified email (**V**, 403 `email_unverified`, ADR-0034). List returns id, `createdAt`, `expiresAt`, `uses`, `maxUses`, never a code. Revoke sets `expires_at = now()` and writes an `invite.revoked` audit row (ADR-0034).
30. Closes the match's `open` call; remaining `pending` applications are rejected in the same transaction and applicants are notified (ADR-0003, ADR-0037). No open call → 404.
31. Upload loaded by `uploads.id = :id AND uploads.user_id = :actor`; anything else → 404. `complete` requires `status = 'pending'` and presign within the last hour (409 `upload_not_pending`). The worker applies the result to `users.avatar_key` or `teams.badge_key` after re-checking that the uploader is still allowed; otherwise the upload ends `rejected` with `not_allowed` (ADR-0030).
32. The venue is resolved by `:slug` through the readable-venue scope (section 5), then only the row `venue_reviews(venue_id = venue.id, user_id = :actor)` is deleted; none → 404. Review paths use the slug because Next.js allows one dynamic segment name per level, shared with `GET venues/:slug`.
33. Call loaded with its match and team. Staff of that team list every application of the call; any other actor with an application on the call lists only their own row; everyone else → 404 (ADR-0013). Query `status?`, `cursor`, `limit` 1..100; sort `(created_at, id)`; items carry the applicant's public card (id, display name, avatar, position, level), never email or district. Allowed in every call state; no rate-limit group (ADR-0041).
34. Team deletion: after the policy check, inside the transaction that holds the `teams` row lock, a team that has at least one match with `status = 'played'` **and** any member besides the captain → 409 `team_has_history`; the captain transfers captaincy (footnote 8) and leaves instead. A team whose only member is the captain, or whose matches are all `draft`/`open`/`locked`/`cancelled`, is deleted with memberships, invites, matches, RSVPs, votes and open calls (cascade) and one `team.deleted` audit row. `cancelled` does not count as history (ADR-0032 amendment). Known limits: the captain may remove every other member first and then delete the solo team; a transfer to a free-tier member who already owns a team is refused (403 `entitlement_required`), while the account-deletion transfer sets `is_pro_locked` instead (ADR-0008, ADR-0032 amendments).

---

## 4. Field-level write rules (mass-assignment and IDOR guard)

Every write schema in `packages/contracts` is `.strict()`; fields not listed as writable are rejected with 400, not silently dropped. "Server" = set only by server code, never accepted from any client.

### 4.1 `users`

| Field                                                                                                                               | Who may write                    | Path                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `display_name` (2..40), `position` (`GK/DEF/MID/FWD`), `level` (`casual/regular/competitive`, ADR-0017), `district_id` (must exist) | self                             | `PATCH me`                                                                                      |
| `avatar_key`                                                                                                                        | server (upload worker)           | Set only by `upload.process` (ADR-0030); `PATCH me` accepts `avatar: null` to remove it         |
| `email`, `email_verified_at`, `password_hash`, `apple_sub`, `google_sub`                                                            | server (auth flows)              | register / verify / reset / provider login                                                      |
| `role`                                                                                                                              | admin + per-action TOTP          | `PATCH admin/users/:id/role`                                                                    |
| `totp_secret_enc`                                                                                                                   | self, staff only, via enrollment | `POST admin/totp/enroll` (pending), `POST admin/totp/confirm` (activation)                      |
| `deactivated_at`                                                                                                                    | server (deletion flow), admin    | `DELETE me`, `PATCH admin/users/:id/deactivate`                                                 |
| `is_tombstone`                                                                                                                      | server (hard delete)             | Set only on tombstone rows created by `account.hard_delete` (ADR-0033); never on a live account |

### 4.2 `teams`, `team_members`, `team_invites`

| Field                                                     | Who may write          | Notes                                                                                      |
| --------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------ |
| `teams.name`, `teams.district_id`                         | co, cap                |                                                                                            |
| `teams.badge_key`                                         | server (upload worker) | Set only by `upload.process` (ADR-0030); `PATCH teams/:id` accepts `badge: null` (co, cap) |
| `teams.slug`                                              | server                 | Generated on create; immutable                                                             |
| `teams.owner_id`                                          | server                 | Changes only through captaincy transfer (footnote 8) or deletion flow                      |
| `teams.is_pro_locked`                                     | server                 | Entitlement job / webhook processing                                                       |
| `team_members.role`                                       | cap                    | Footnote 8                                                                                 |
| `team_members.user_id`, `team_id`, `joined_at`            | server                 | From invite accept / team create                                                           |
| `team_invites.expires_at` (1 h..14 d), `max_uses` (1..50) | co, cap                |                                                                                            |
| `team_invites.code_hash`, `uses`                          | server                 | Plaintext code never stored (ADR-0011)                                                     |
| `team_invites` revoke (`expires_at = now()`)              | co, cap                | `DELETE teams/:id/invites/:inviteId` (ADR-0034)                                            |

### 4.3 RSVP, lineup, payments, votes

| Field                                 | Who may write | Notes                                                                                  |
| ------------------------------------- | ------------- | -------------------------------------------------------------------------------------- |
| `match_rsvps.status` (`in/out/maybe`) | self          | Footnote 14; `waitlist` server-only                                                    |
| `match_rsvps.side`                    | co, cap       | Through `PUT lineup` only                                                              |
| `match_rsvps.paid`                    | co, cap       | Through `PATCH payments/:userId` only; self only for cap; always audited (footnote 16) |
| `match_rsvps.user_id`, `match_id`     | server        | From session and path                                                                  |
| `match_rsvps.waitlisted_at`           | server        | Set when the server assigns `waitlist`, cleared on promotion or leave (ADR-0035)       |
| `mvp_votes.votee_id`                  | self (voter)  | `voter_id` from session                                                                |

### 4.4 `matches`, `open_calls`, `open_call_applications`

| Field                                                                                                       | Who may write                                          | Notes                                                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- |
| `matches.venue_id`, `venue_text`, `starts_at`, `format`, `fee_total_minor`, `slots`, `status`               | co, cap                                                | Footnote 12                                                      |
| `matches.team_id`                                                                                           | server                                                 | From path on create; immutable                                   |
| `matches.mvp_vote_closes_at`                                                                                | server                                                 |                                                                  |
| `matches.locked_at`                                                                                         | server                                                 | Set on first lock; never cleared (ADR-0004)                      |
| `open_calls.missing_count`, `position`, `level` (`casual/regular/competitive`), `district_id`, `expires_at` | co, cap                                                | At publish only                                                  |
| `open_calls.match_id`                                                                                       | server                                                 |                                                                  |
| `open_calls.status`                                                                                         | co, cap (`closed` only); server otherwise              | Footnote 30; `expired` by job, `removed` by moderator (ADR-0037) |
| `open_call_applications.message`                                                                            | applicant                                              | At create only                                                   |
| `open_call_applications.status`                                                                             | co, cap (`accepted/rejected`); applicant (`withdrawn`) | Footnotes 21, 22                                                 |
| `open_call_applications.user_id`, `open_call_id`                                                            | server                                                 |                                                                  |

### 4.5 Venues, reviews, push, billing, system tables

| Field                                                                                                                 | Who may write                                    | Notes                                                                                                  |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `venues.name`, `district_id`, `point`, `address`, `phone`, `indoor`, `features`, `price_min_minor`, `price_max_minor` | creator at create; mod/admin + stepUp afterwards | `features` validated against a closed key set                                                          |
| `venues.verified`                                                                                                     | mod/admin + stepUp                               | Audited                                                                                                |
| `venues.slug`, `is_sample`, `created_by`                                                                              | server                                           | `is_sample` only by seed script                                                                        |
| `venue_reviews.rating`, `text`                                                                                        | author at create                                 | No edit endpoint in MVP                                                                                |
| `venue_reviews` delete                                                                                                | mod/admin + stepUp                               | Audited                                                                                                |
| `push_tokens.expo_token`, `platform`                                                                                  | self                                             | `user_id`, `last_seen_at` server                                                                       |
| `subscriptions.*`                                                                                                     | server only                                      | Webhook processing + nightly reconciliation                                                            |
| `refresh_tokens`, `email_tokens`, `webhook_events`, `rate_limit_buckets`, `deletion_requests`, `audit_logs`           | server only                                      | No client write path exists. `audit_logs` is append-only (no UPDATE/DELETE grant for the app role).    |
| `uploads` (P2)                                                                                                        | server only                                      | Created at presign from the actor and path; status written by the endpoints and the worker (ADR-0030). |
| `job_receipts`, pg-boss tables (P2)                                                                                   | server only                                      | Web role may only insert jobs; the worker role owns the `pgboss` schema (ADR-0028).                    |
| `venues.search_name` (P2)                                                                                             | server                                           | Derived from `name` by `foldTr` (ADR-0039).                                                            |

---

## 5. Ownership and query-scoping rules

Every read or write of a team-scoped resource loads the row through a join that already proves the relationship. A client-supplied `teamId` is never trusted alone (§6 item 4).

| Resource                                | Owner relation                                 | Mandatory scoping predicate (Drizzle `where`)                                                                                                                                 |
| --------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `teams`                                 | members                                        | `teams.id = :id AND EXISTS (team_members tm WHERE tm.team_id = teams.id AND tm.user_id = :actor)`                                                                             |
| `team_members` (target)                 | team                                           | `tm.team_id = :teamId AND tm.user_id = :userId` **and** actor membership row loaded in the same query                                                                         |
| `team_invites`                          | team staff (create); anyone with code (accept) | accept: lookup by `code_hash = sha256(:code)` only, never by id                                                                                                               |
| `matches`                               | team of `matches.team_id`                      | `matches.id = :id AND (EXISTS member(matches.team_id, :actor) OR EXISTS match_rsvps(match_id = matches.id, user_id = :actor))`                                                |
| `match_rsvps` (own)                     | self                                           | `match_id = :id AND user_id = :actor`                                                                                                                                         |
| `match_rsvps` (payment / lineup target) | team staff                                     | two steps (section 2, steps 4–6): match through the `matches` participant predicate → `can()` (player / guest 403) → `match_id = :id AND user_id = :userId` inside that match |
| `open_calls`                            | team of the call's match                       | public read via public projection view; writes via `open_calls → matches → team_members(actor, staff)`                                                                        |
| `open_call_applications`                | applicant + call's team staff                  | `app.id = :appId AND app.open_call_id = :id AND (app.user_id = :actor OR staff(actor, call.match.team_id))`                                                                   |
| `open_call_applications` list (P2)      | call staff (all), applicant (own)              | `app.open_call_id = :id AND (staff(actor, call.match.team_id) OR app.user_id = :actor)`; neither → 404 before reading rows                                                    |
| `venues`                                | public; unverified → creator                   | `verified OR is_sample OR created_by = :actor`                                                                                                                                |
| `venue_reviews`                         | author (content), public (read)                | read joined with readable venue                                                                                                                                               |
| `push_tokens`                           | self                                           | `user_id = :actor`                                                                                                                                                            |
| `uploads` (P2)                          | uploader                                       | `uploads.id = :id AND uploads.user_id = :actor`                                                                                                                               |
| `team_invites` list / revoke (P2)       | team staff                                     | `team_invites.team_id = :teamId` with actor staff membership loaded in the same query; revoke also `team_invites.id = :inviteId`                                              |
| `subscriptions`                         | self (read via `GET me` entitlement summary)   | `user_id = :actor`                                                                                                                                                            |
| R2 objects                              | self (avatars), team staff (badges)            | keys derived server-side from the upload id; a client never chooses or submits a key; unprocessed objects live in a private bucket (ADR-0030)                                 |

UUIDv7 ids (ADR-0016) are time-ordered and therefore **not** secret; authorization never relies on id unguessability.

---

## 6. Data exposure (read projections)

| Data                                                | Visible to                                                                                                                                                                                                                              |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Own email, own provider links, own deletion status  | self only (`GET me`)                                                                                                                                                                                                                    |
| Other users' email                                  | nobody through the API (admins see a masked form `a***@d***` in admin lists)                                                                                                                                                            |
| Display name, avatar, position, level, public stats | teammates, participants of a shared match, captain/co-captain of a call the user applied to, review readers (display name only)                                                                                                         |
| District of a user                                  | self only                                                                                                                                                                                                                               |
| Team roster                                         | team members                                                                                                                                                                                                                            |
| Match RSVPs, lineup, per-player share               | participants; `paid` flags only to team members                                                                                                                                                                                         |
| Open call (public projection, footnote 18)          | everyone incl. anon                                                                                                                                                                                                                     |
| Applications to a call                              | the applicant (own) and the call's team staff; applicant shown by public card only (no email, no district) (ADR-0041)                                                                                                                   |
| Venue + reviews                                     | everyone (verified / sample); creator (own unverified)                                                                                                                                                                                  |
| Audit logs                                          | admin + stepUp                                                                                                                                                                                                                          |
| Invite preview (P2)                                 | anyone holding the code: team name, badge, district, member count (ADR-0034)                                                                                                                                                            |
| MVP vote tallies                                    | participants, only after `mvp_vote_closes_at`; before that only the actor's own vote (ADR-0036)                                                                                                                                         |
| Tombstones of deleted accounts                      | shown as "Silinmiş oyuncu" inside match history only; no profile, no avatar, excluded from lists (ADR-0033)                                                                                                                             |
| Upload status (P2)                                  | the uploader only                                                                                                                                                                                                                       |
| Push `data` of application notifications (P3)       | the recipient's device: `{ type, applicationId, matchId }`, ids only; the match id discloses nothing new (the captain already reads the match, an accepted applicant reaches it only through the guest projection) (ADR-0031, ADR-0079) |

---

## 7. Entitlement gates (Kadro Pro, enforced server-side)

| Feature               | Free        | Pro       | Enforcement point                                                                                      | Status on `main`                                                                                   |
| --------------------- | ----------- | --------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Teams owned (captain) | 1           | unlimited | `team.create`, captaincy transfer **to** a free user who already owns one (403 `entitlement_required`) | Enforced from `subscriptions` (ADR-0065)                                                           |
| Lineup history        | latest only | full      | `match.read` projection                                                                                | Not implemented: no lineup history is stored, the gate needs a product definition first (ADR-0065) |
| Advanced stats        | basic       | full      | `GET me/stats` (`advanced` block)                                                                      | Enforced from `subscriptions` (ADR-0065)                                                           |
| Upsell banners        | shown       | hidden    | client-only (no security impact)                                                                       | Paywall screens exist in the app behind a billing port, unverified against real stores (ADR-0077)  |

A user is Pro when at least one of their `subscriptions` rows has status `active` or `grace_period` **and** an `expires_at` that is null or later than now, in either environment (ADR-0065). The value is read on every request, so a lapse takes effect on the next request even if the store event is late.

Downgrade: when Pro lapses and the user owns more than one team, all but the oldest-created owned team are set `is_pro_locked = true` (read-only: `match.create`, `team.update`, `invite.create`, `opencall.publish` → 403 `entitlement_required`; reads and RSVP keep working). Entitlement state comes only from `subscriptions` (webhook + reconciliation), never from a client claim or the RevenueCat SDK response on the device. The gates on locked teams are enforced; no job writes `is_pro_locked` on a downgrade yet (only the account hard-delete transfer sets it, ADR-0065 "Not covered here").

---

## 8. Rate-limit groups referenced above

Spec-fixed values come from §6 items 5, 7 and 22; the others are **proposed** defaults for Phase 1/2 and are recorded in an ADR when implemented. Keys live in `rate_limit_buckets` as keyed hashes (`HASH_SECRET`, ADR-0023); the IP comes from the trusted proxy header only. When that header is missing or malformed, all such requests share the IP bucket `unknown` of their group and the `client_ip_missing` alert fires (ADR-0022).

| Group | Endpoints                                                          | Limit                                          | Key                                       | Source                            |
| ----- | ------------------------------------------------------------------ | ---------------------------------------------- | ----------------------------------------- | --------------------------------- |
| A     | `auth/login, register, forgot, reset, verify-email, apple, google` | 5 / 15 min, progressive delay after 3 failures | IP **and** email                          | spec                              |
| R     | `auth/refresh`                                                     | 30 / 15 min                                    | refresh family                            | proposed                          |
| T     | `admin/step-up`, `admin/totp/enroll`, `admin/totp/confirm`         | 5 / 15 min                                     | user                                      | ADR-0064                          |
| I     | `invites/:code/accept`, `GET invites/:code`                        | 20 / h                                         | user + IP (IP only for anonymous preview) | proposed (code probing), ADR-0034 |
| O     | `open-calls/:id/applications` (create)                             | 30 / day                                       | user                                      | proposed                          |
| V     | `POST venues`                                                      | 5 / day                                        | user                                      | proposed                          |
| W     | `POST venues/:slug/reviews`                                        | 10 / day                                       | user                                      | proposed                          |
| C     | `POST matches/:id/open-call` (P2)                                  | 10 / day                                       | user                                      | ADR-0037                          |
| D     | `DELETE me` (P2)                                                   | 5 / 15 min                                     | user                                      | ADR-0032                          |
| U     | `uploads/presign`                                                  | 10 / rolling 24 h                              | user                                      | spec (ADR-0030)                   |
| P     | `me/push-tokens`                                                   | 10 / day                                       | user                                      | proposed                          |
| G     | all other authenticated mutations                                  | 120 / min                                      | user                                      | proposed                          |

---

## 9. Turning this document into code and tests (Phase 1)

### 9.1 Policy module shape (`packages/auth/src/policies.ts`)

Implemented interface:

```ts
interface ActorContext {
  userId: string | null; // null = guest
  platformRole: PlatformRole | null; // users.role, loaded per request (ADR-0012)
  emailVerified: boolean;
  deactivated: boolean; // users.deactivated_at IS NOT NULL → can() returns 401 account_deactivated
  stepUpUntil: Date | null; // server-side step-up record on the session / refresh family
  isPro: boolean; // from subscriptions (ADR-0065)
}

interface ResourceContext {
  teamRole?: TeamRole | null; // actor's role in the owning team, null = not a member
  isMatchGuest?: boolean;
  isApplicant?: boolean;
  isCreator?: boolean;
  isSelf?: boolean; // nested target (member, payment row) is the actor
  targetTeamRole?: TeamRole; // member.remove / member.updateRole
  newTeamRole?: TeamRole; // member.updateRole; 'captain' = captaincy transfer
  targetOwnedTeams?: number; // captaincy transfer entitlement
  targetIsPro?: boolean; // captaincy transfer entitlement
  actorOwnedTeams?: number; // team.create owned-team limit
  teamProLocked?: boolean; // teams.is_pro_locked
  venuePublic?: boolean; // venue verified or is_sample
  playedAtVenue?: boolean; // actor has an in RSVP on a played match at this venue
  ownsResource?: boolean; // addressed upload or review belongs to the actor
  reauthenticated?: boolean; // valid single-use re-auth proof
  freshTotp?: boolean; // fresh, valid TOTP code
}

type Projection = 'member' | 'guest';
type RowScope = 'all' | 'own';
type DenyStatus = 401 | 403 | 404 | 409;
type Decision =
  | { allow: true; projection?: Projection; rows?: RowScope }
  | { allow: false; status: DenyStatus; code: ErrorCode };

class PolicyContextError extends Error {
  readonly action: Action;
  readonly fact: keyof ResourceContext;
  constructor(action: Action, fact: keyof ResourceContext);
}

export function can(
  actor: ActorContext,
  action: Action,
  resource: ResourceContext = {},
  options: PolicyOptions = {},
): Decision;

interface PolicyOptions {
  now?: Date;
}
```

Rules the implementation follows:

- Evaluation order inside `can()`: authentication (401 `unauthenticated`, 401 `account_deactivated`) → read relationship (404) → email verification on **V** actions (403 `email_unverified`) → relationship cell (allow / 403 / 409) → entitlement (403 `entitlement_required`). Admin actions: staff role (403) → step-up (401 `step_up_required`) → admin tier (403) → per-action proof.
- `can()` returns 409 `already_participant` for a member or participant on `invite.accept` or `application.create`, and 409 `captain_must_transfer` when the captain leaves. Other 409s are domain-service state preconditions.
- Missing re-auth proof for `me.delete` or `admin.totpEnroll` → 401 `reauth_required`. Staff `me.delete` without a fresh TOTP code → 401 `step_up_required`.
- `application.list` allows `{ allow: true, rows: 'all' }` for team staff and `{ allow: true, rows: 'own' }` for the applicant. `projection` is returned for allowed match-scoped decisions; `application.decide` and `application.withdraw` do not return it.
- A fact the evaluation needs but the handler did not pass throws `PolicyContextError` (fail closed; a programming error, never a user-facing result). An unknown action throws `RangeError`.
- Platform staff are never read by the regular rules (ADR-0007).

`can()` encodes the role/relationship cells of section 3, the role parts of section 4 and the entitlement gates of section 7. State preconditions (footnotes 7, 12–21) live in the domain services and are tested in integration tests, so the policy table stays declarative. Table-driven tests: `packages/auth/src/policies.test.ts`.

### 9.2 Fixture set for table-driven tests

| Fixture                     | Description                                                             |
| --------------------------- | ----------------------------------------------------------------------- |
| `anon`                      | no credentials                                                          |
| `uNoTeam`                   | verified user, no memberships                                           |
| `uUnverified`               | unverified email, no memberships                                        |
| `capA`                      | captain (owner) of team A                                               |
| `coA`                       | co-captain of team A                                                    |
| `plyA`                      | player of team A                                                        |
| `capB`                      | captain of team B (cross-tenant attacker)                               |
| `gstM1`                     | free player accepted into match M1 of team A via open call              |
| `modNoStep` / `modStep`     | moderator without / with valid step-up                                  |
| `adminNoStep` / `adminStep` | admin without / with valid step-up                                      |
| `modPlyA`                   | moderator who is also a player of team A (proves staff get no override) |
| `exPlyA`                    | former player of team A with one `played` and one `locked` match        |
| `appC1`                     | free player with a `pending` application to open call C1 of team A      |
| `uDeactivated`              | user with `deactivated_at` set and a still-unexpired access JWT         |

### 9.3 Required test rows (minimum)

- One row per **(endpoint × column)** cell of section 3 → expected status; generated from a single array so a new endpoint without rows fails a coverage assertion.
- IDOR set (`apps/web/tests/security/idor.test.ts`): `capB` against every team-A resource id (team, member, invite, match, RSVP, lineup, payment, open call, application, badge presign) → 404; `plyA` against every staff action → 403; `gstM1` against team A roster / other matches → 404; nested-id mismatch (`/open-calls/{callOfTeamB}/applications/{appOfTeamA}`) → 404.
- Field rules: each server-only field from section 4 sent in a body → 400.
- Staff no-override: `modPlyA` and `adminStep` on `PATCH matches/:id` of team A where they are not staff → 403 / 404.
- Step-up: `modNoStep` on `GET admin/**` → 401 `step_up_required`; `modStep` on `PATCH admin/users/:id/role` → 403; `adminStep` without the per-action `totpCode` → 400 `validation_failed`, with a wrong code → 401 `totp_invalid`; admin self-demotion or self-deactivation → 403 (footnote 27); demoting the last active admin → 409 `last_admin`. Evidence: `apps/web/tests/admin/moderation.test.ts`, `apps/web/tests/attack/edge-admin-escalation.test.ts`, `apps/web/tests/attack/edge-totp.test.ts`.
- Audit: every allowed admin mutation and every `payment.mark` produces exactly one `audit_logs` row without email or name in `metadata`.
- Applications: `plyA` and `gstM1` on `application.decide` → 404; `appC1` on decide → 403; `coA` on withdraw of `appC1`'s application → 403.
- Payments: `plyA` / `gstM1` → 403; `coA` on own payment → 403; `capA` on own payment → 200; `capA` on a user without RSVP → 404.
- Former member: `exPlyA` → team 404, `locked` match 404, `played` match guest projection.
- Deactivation: `uDeactivated` on `GET me` and on any mutation → 401 `account_deactivated`.
- Entitlement: every entitlement denial → 403 `entitlement_required`; no 409 with that code exists.
- Invites (P2): `plyA` on `invite.list` / `invite.revoke` → 403; `capB` → 404; preview of an expired, revoked or exhausted code → the same 404 as an unknown code.
- Uploads (P2): `capB` on `uploads/:id/complete` and `GET uploads/:id` of `capA`'s upload → 404; `plyA` badge presign for team A → 403; any body field naming a storage key (`avatarKey`, `badgeKey`, `key`) → 400; badge upload completed after the uploader was demoted → `rejected` / `not_allowed`.
- Open calls (P2): `plyA` on `opencall.close` → 403; `capB` → 404. `application.list`: `coA` sees every application of C1; `appC1` sees exactly its own row; `plyA`, `gstM1`, `capB`, `modStep` → 404; no item contains an email.
- Invites (P2): `uUnverified` captain on `invite.create` → 403 `email_unverified`.
- Reviews (P2): `uNoTeam` without a played match at the venue → 403 `review_not_eligible`; `review.deleteOwn` without an own review → 404.
- Deletion (P2): `DELETE me` without re-auth → 401; sixth attempt in 15 min → 429; tombstone rows can never authenticate.
- Statistics and reference data (P3): `GET me/stats` anonymous → 401, free user → basic tier, Pro user → `advanced` block, basic again once the subscription lapses (`apps/web/tests/auth/stats.test.ts`); `GET districts` answers anonymous, web and signed-in callers the same list, requires `x-kadro-client` and rejects unknown query keys (`apps/web/tests/districts/districts.test.ts`).
- Webhook (P5): no / wrong `Authorization` → 401 and nothing stored, no secret configured → 503, replayed event id → 200 `duplicate`, unknown or anonymous `app_user_id` → 200 `ignored` (`apps/web/tests/billing/webhook.test.ts`, `apps/web/tests/attack/webhook-forgery.test.ts`).
- Admin (P5): the staff role → step-up → admin tier chain on the admin routes, and the lists and mutations of section 3.8 with their audit rows (`apps/web/tests/admin/moderation.test.ts`, `apps/web/tests/admin/step-up.test.ts`); escalation, window and concurrency edges in `apps/web/tests/attack/edge-admin-escalation.test.ts`; TOTP replay and attempt budget in `apps/web/tests/attack/edge-totp.test.ts`.
- Attack sweeps (Phase 6): 32 of the 35 id-bearing routes as stranger and as another team's captain (invite preview, invite accept and applying to a public open call are exempt by design), status and body equal to unknown ids (`apps/web/tests/attack/tenant-bola.test.ts`); unknown keys on every schema and one extra field on 18 write routes (`apps/web/tests/attack/tenant-mass-assignment.test.ts`); anonymous 401 on every protected route (`apps/web/tests/attack/anonymous-access.test.ts`). Admin write routes have no runtime mass-assignment probe, only the schema walk (`attack-report.md` §4).

---

## 10. Cross-owner requirements and open questions

Decided (Phase 1), to be implemented by the owners of the listed packages:

| Requirement                                                                                                     | Owner                | ADR                |
| --------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------ |
| Unique constraint `open_call_applications(open_call_id, user_id)`                                               | `packages/db`        | ADR-0010           |
| `team_invites.code_hash` (SHA-256, unique) instead of `code`                                                    | `packages/db`        | ADR-0011           |
| `matches.locked_at timestamptz NULL`, server-only                                                               | `packages/db`        | ADR-0004           |
| Partial unique index `team_members(team_id) WHERE role = 'captain'`                                             | `packages/db`        | ADR-0008           |
| Admin endpoints (section 3.8) and the `withdrawn` value on the application PATCH                                | `packages/contracts` | ADR-0007, ADR-0064 |
| Actor context loads `role`, `email_verified_at`, `deactivated_at` from `users` per request; JWT carries no role | `packages/auth`      | ADR-0012           |
| `refresh_tokens.client` (`mobile` / `web`); web sessions stored as `client = 'web'` rows                        | `packages/db`        | ADR-0014           |
| `x-kadro-client` header schema; one `player_level` enum (`casual/regular/competitive`) for users and open calls | `packages/contracts` | ADR-0014, ADR-0017 |

Decided (Phase 2), handoffs `docs/handoffs/decisions-to-*-001.md`:

| Requirement                                                                                                                                                                     | Owner                               | ADR                                |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------- |
| New policy actions `invite.list`, `invite.revoke`, `invite.preview`, `opencall.close`, `upload.complete`, `upload.read`, `review.deleteOwn`, `application.list` with table rows | `packages/auth`                     | 0030, 0034, 0037, 0038, 0041       |
| New endpoints and error codes of this document (rows marked P2), job payload schemas, `foldTr`, `suggestLineup`                                                                 | `packages/contracts`                | 0028–0039                          |
| `uploads`, `job_receipts`, `users.is_tombstone`, `match_rsvps.waitlisted_at`, `venues.search_name`, `deletion_requests.external_pending`                                        | `packages/db`                       | 0028, 0030, 0032, 0033, 0035, 0039 |
| Authentication refuses rows with `is_tombstone = true`                                                                                                                          | `apps/web` (auth)                   | 0033                               |
| `avatar_key` / `badge_key` written only by the upload worker; client write schemas carry only `avatar: null` / `badge: null`                                                    | `packages/contracts`, `apps/worker` | 0030                               |

Open:

1. Resolved by ADR-0038: a review author may delete their own review through `DELETE venues/:slug/reviews/mine` (Phase 2); moderators remove others' reviews through `DELETE admin/reviews/:id` (Phase 5, ADR-0067).
