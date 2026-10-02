# Architecture Decision Records

One decision per file, numbered sequentially (`NNNN-short-title.md`). An ADR is never rewritten
after acceptance; a later ADR supersedes it and both link to each other.

Each record contains: Status, Date, Deciders, Context, Options (when more than one was weighed),
Decision, Consequences.

| ADR                                                     | Title                                                                  | Status                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------ |
| [0001](0001-stack-and-versions.md)                      | Stack and pinned versions                                              | Accepted                       |
| [0002](0002-hosting.md)                                 | Hosting: Docker on a VPS behind Caddy                                  | Accepted                       |
| [0003](0003-open-call-acceptance-preconditions.md)      | Open-call application acceptance preconditions                         | Accepted                       |
| [0004](0004-match-lock-and-reopen.md)                   | Match lock, reopen and frozen commercial fields                        | Accepted                       |
| [0005](0005-removed-member-access.md)                   | Access of removed or departed team members                             | Accepted                       |
| [0006](0006-payment-marking-and-audit.md)               | Payment marking rules and mandatory audit                              | Accepted                       |
| [0007](0007-staff-no-override-on-regular-api.md)        | Platform staff have no override on the regular API                     | Accepted                       |
| [0008](0008-team-roles-and-captaincy-transfer.md)       | Team role changes and atomic captaincy transfer                        | Accepted                       |
| [0009](0009-admin-bootstrap-and-last-admin.md)          | First-admin bootstrap and last-admin protection                        | Accepted                       |
| [0010](0010-one-application-per-user-per-call.md)       | One application per user per open call                                 | Accepted                       |
| [0011](0011-hashed-invite-codes.md)                     | Team invite codes stored as hashes                                     | Accepted                       |
| [0012](0012-account-state-checked-per-request.md)       | Account state checked on every authenticated request                   | Accepted                       |
| [0013](0013-authorization-status-codes.md)              | Status codes for nested resources and missing entitlements             | Accepted                       |
| [0014](0014-client-type-and-session-transport.md)       | Client type header and session transport                               | Accepted                       |
| [0015](0015-non-enumerating-register-and-forgot.md)     | Register and forgot-password never reveal account existence            | Accepted                       |
| [0016](0016-uuidv7-identifiers.md)                      | UUIDv7 for all primary keys                                            | Accepted                       |
| [0017](0017-player-and-call-levels.md)                  | Player and open-call levels follow the specification                   | Accepted                       |
| [0018](0018-breach-check-fails-open.md)                 | Password breach check fails open                                       | Accepted                       |
| [0019](0019-refresh-rotation-without-grace-window.md)   | Refresh rotation without a grace window; clients refresh single-flight | Accepted                       |
| [0020](0020-client-header-exempt-routes.md)             | Routes exempt from the client type header (amends 0014)                | Accepted                       |
| [0021](0021-csp-per-surface.md)                         | Content-Security-Policy per surface                                    | Accepted (verified in Phase 4) |
| [0022](0022-body-limit-status-and-missing-client-ip.md) | 413 for oversized bodies; shared bucket when the client IP is missing  | Accepted                       |
| [0023](0023-keyed-hash-secret.md)                       | Separate `HASH_SECRET` for keyed hashes                                | Accepted                       |
| [0024](0024-db-migrate-subpath.md)                      | Migrations exposed only through `@kadro/db/migrate`                    | Accepted                       |
| [0025](0025-session-family-checked-per-request.md)      | Session family checked on every authenticated request (amends 0012)    | Accepted                       |
| [0026](0026-email-delivery-phase1-best-effort.md)       | Auth email delivery: best effort in Phase 1, durable job in Phase 2    | Superseded by 0029 (Phase 2)   |
| [0027](0027-email-link-landing-pages.md)                | Email-link landing pages delivered with Phase 2 and Phase 3            | Accepted                       |
| [0028](0028-worker-queues-and-job-conventions.md)       | Worker queues, job conventions and the web → worker path               | Accepted                       |
| [0029](0029-durable-email-delivery.md)                  | Durable email delivery with worker-issued tokens (supersedes 0026)     | Accepted                       |
| [0030](0030-image-upload-pipeline.md)                   | Image upload pipeline: signed-length PUT, quarantine, worker re-encode | Accepted                       |
| [0031](0031-push-notifications.md)                      | Push notifications: types, content, Expo delivery, hourly cap          | Accepted                       |
| [0032](0032-account-deletion-flow.md)                   | Account deletion: request, grace period and hard delete                | Accepted                       |
| [0033](0033-per-account-history-tombstone.md)           | One tombstone row per deleted account instead of a shared sentinel     | Accepted                       |
| [0034](0034-team-invites-and-joining.md)                | Team invite lifecycle and joining                                      | Accepted                       |
| [0035](0035-rsvp-waitlist-and-lineup.md)                | RSVP, waitlist promotion and lineup validity                           | Accepted                       |
| [0036](0036-fee-split-and-mvp-voting.md)                | Fee split computation and MVP voting window                            | Accepted                       |
| [0037](0037-open-call-lifecycle.md)                     | Open-call lifecycle, publish limits and expiry job (amends 0003)       | Accepted                       |
| [0038](0038-venues-and-review-eligibility.md)           | Venue creation, visibility and review eligibility                      | Accepted                       |
| [0039](0039-search-filters-and-cursor-pagination.md)    | District filters, text search and cursor pagination                    | Accepted                       |
| [0040](0040-email-link-pages-phase2-scope.md)           | Email-link pages at the end of Phase 2 (details 0027)                  | Accepted                       |
| [0041](0041-open-call-application-list.md)              | Listing the applications of an open call                               | Accepted                       |
| [0043](0043-node-forge-advisory-exception.md)           | Documented exception for node-forge advisory GHSA-86w9-cpqp-85rv       | Accepted                       |
| [0042](0042-ci-test-job-and-required-check.md)          | CI test job, no silent skips and one required check                    | Accepted                       |

ADRs 0003–0027 record the authorization and domain-integrity decisions behind
`docs/security/authorization-matrix.md`. Schema consequences for `packages/db`: `matches.locked_at`
(0004), partial unique index for one captain per team (0008), unique
`open_call_applications(open_call_id, user_id)` (0010), `team_invites.code_hash` instead of `code`
(0011), `refresh_tokens.client` (0014), one `player_level` enum (0017).

ADRs 0028–0041 record the Phase 2 domain, worker, upload, notification and deletion decisions.
Schema consequences (handoff `docs/handoffs/decisions-to-db-001.md`): `job_receipts` (0028),
`uploads` (0030), `deletion_requests.external_pending` (0032), `users.is_tombstone` (0033),
`match_rsvps.waitlisted_at` (0035), `venues.search_name` with `pg_trgm` (0039).
