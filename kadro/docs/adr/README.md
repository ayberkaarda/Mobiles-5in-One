# Architecture Decision Records

One decision per file, numbered sequentially (`NNNN-short-title.md`). An ADR is never rewritten
after acceptance; a later ADR supersedes it and both link to each other.

Each record contains: Status, Date, Deciders, Context, Options (when more than one was weighed),
Decision, Consequences.

| ADR                                                                   | Title                                                                                         | Status                                      |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| [0001](0001-stack-and-versions.md)                                    | Stack and pinned versions                                                                     | Accepted                                    |
| [0002](0002-hosting.md)                                               | Hosting: Docker on a VPS behind Caddy                                                         | Accepted                                    |
| [0003](0003-open-call-acceptance-preconditions.md)                    | Open-call application acceptance preconditions                                                | Accepted                                    |
| [0004](0004-match-lock-and-reopen.md)                                 | Match lock, reopen and frozen commercial fields                                               | Accepted                                    |
| [0005](0005-removed-member-access.md)                                 | Access of removed or departed team members                                                    | Accepted                                    |
| [0006](0006-payment-marking-and-audit.md)                             | Payment marking rules and mandatory audit                                                     | Accepted                                    |
| [0007](0007-staff-no-override-on-regular-api.md)                      | Platform staff have no override on the regular API                                            | Accepted                                    |
| [0008](0008-team-roles-and-captaincy-transfer.md)                     | Team role changes and atomic captaincy transfer                                               | Accepted                                    |
| [0009](0009-admin-bootstrap-and-last-admin.md)                        | First-admin bootstrap and last-admin protection                                               | Accepted                                    |
| [0010](0010-one-application-per-user-per-call.md)                     | One application per user per open call                                                        | Accepted                                    |
| [0011](0011-hashed-invite-codes.md)                                   | Team invite codes stored as hashes                                                            | Accepted                                    |
| [0012](0012-account-state-checked-per-request.md)                     | Account state checked on every authenticated request                                          | Accepted                                    |
| [0013](0013-authorization-status-codes.md)                            | Status codes for nested resources and missing entitlements                                    | Accepted                                    |
| [0014](0014-client-type-and-session-transport.md)                     | Client type header and session transport                                                      | Accepted                                    |
| [0015](0015-non-enumerating-register-and-forgot.md)                   | Register and forgot-password never reveal account existence                                   | Accepted                                    |
| [0016](0016-uuidv7-identifiers.md)                                    | UUIDv7 for all primary keys                                                                   | Accepted                                    |
| [0017](0017-player-and-call-levels.md)                                | Player and open-call levels follow the specification                                          | Accepted                                    |
| [0018](0018-breach-check-fails-open.md)                               | Password breach check fails open                                                              | Accepted                                    |
| [0019](0019-refresh-rotation-without-grace-window.md)                 | Refresh rotation without a grace window; clients refresh single-flight                        | Accepted                                    |
| [0020](0020-client-header-exempt-routes.md)                           | Routes exempt from the client type header (amends 0014)                                       | Accepted                                    |
| [0021](0021-csp-per-surface.md)                                       | Content-Security-Policy per surface                                                           | Accepted (verified in Phase 4)              |
| [0022](0022-body-limit-status-and-missing-client-ip.md)               | 413 for oversized bodies; shared bucket when the client IP is missing                         | Accepted                                    |
| [0023](0023-keyed-hash-secret.md)                                     | Separate `HASH_SECRET` for keyed hashes                                                       | Accepted                                    |
| [0024](0024-db-migrate-subpath.md)                                    | Migrations exposed only through `@kadro/db/migrate`                                           | Accepted                                    |
| [0025](0025-session-family-checked-per-request.md)                    | Session family checked on every authenticated request (amends 0012)                           | Accepted                                    |
| [0026](0026-email-delivery-phase1-best-effort.md)                     | Auth email delivery: best effort in Phase 1, durable job in Phase 2                           | Superseded by 0029 (Phase 2)                |
| [0027](0027-email-link-landing-pages.md)                              | Email-link landing pages delivered with Phase 2 and Phase 3                                   | Accepted                                    |
| [0028](0028-worker-queues-and-job-conventions.md)                     | Worker queues, job conventions and the web → worker path                                      | Accepted                                    |
| [0029](0029-durable-email-delivery.md)                                | Durable email delivery with worker-issued tokens (supersedes 0026)                            | Accepted                                    |
| [0030](0030-image-upload-pipeline.md)                                 | Image upload pipeline: signed-length PUT, quarantine, worker re-encode                        | Accepted                                    |
| [0031](0031-push-notifications.md)                                    | Push notifications: types, content, Expo delivery, hourly cap                                 | Accepted                                    |
| [0032](0032-account-deletion-flow.md)                                 | Account deletion: request, grace period and hard delete                                       | Accepted                                    |
| [0033](0033-per-account-history-tombstone.md)                         | One tombstone row per deleted account instead of a shared sentinel                            | Accepted                                    |
| [0034](0034-team-invites-and-joining.md)                              | Team invite lifecycle and joining                                                             | Accepted                                    |
| [0035](0035-rsvp-waitlist-and-lineup.md)                              | RSVP, waitlist promotion and lineup validity                                                  | Accepted                                    |
| [0036](0036-fee-split-and-mvp-voting.md)                              | Fee split computation and MVP voting window                                                   | Accepted                                    |
| [0037](0037-open-call-lifecycle.md)                                   | Open-call lifecycle, publish limits and expiry job (amends 0003)                              | Accepted                                    |
| [0038](0038-venues-and-review-eligibility.md)                         | Venue creation, visibility and review eligibility                                             | Accepted                                    |
| [0039](0039-search-filters-and-cursor-pagination.md)                  | District filters, text search and cursor pagination                                           | Accepted                                    |
| [0040](0040-email-link-pages-phase2-scope.md)                         | Email-link pages at the end of Phase 2 (details 0027)                                         | Accepted                                    |
| [0041](0041-open-call-application-list.md)                            | Listing the applications of an open call                                                      | Accepted                                    |
| [0042](0042-ci-test-job-and-required-check.md)                        | CI test job, no silent skips and one required check                                           | Accepted                                    |
| [0043](0043-node-forge-advisory-exception.md)                         | Documented exception for node-forge advisory GHSA-86w9-cpqp-85rv                              | Accepted                                    |
| [0044](0044-push-resend-after-active-delivery.md)                     | Re-sending a coalesced push after a change during its delivery                                | Accepted                                    |
| [0045](0045-deep-link-naming.md)                                      | Deep-link naming: one path set for web, scheme and app links                                  | Accepted                                    |
| [0046](0046-security-workflow-gate.md)                                | Security workflow without a path filter and one gate                                          | Accepted                                    |
| [0047](0047-mobile-client-architecture.md)                            | Mobile client architecture: API client, session, query cache and test setup                   | Accepted                                    |
| [0048](0048-mobile-i18n-and-error-copy.md)                            | Mobile translations and error copy                                                            | Accepted                                    |
| [0049](0049-mobile-auth-flows.md)                                     | Mobile auth flows: screens, email links and provider sign-in                                  | Accepted                                    |
| [0050](0050-mobile-teams-screens.md)                                  | Mobile teams: screens, invites and roster writes                                              | Accepted                                    |
| [0051](0051-mobile-match-screens.md)                                  | Mobile matches: screens, RSVP, lineup, payments and MVP vote                                  | Accepted                                    |
| [0052](0052-mobile-open-call-screens.md)                              | Mobile open calls (Eksik Var): list, apply, publish and decide                                | Accepted                                    |
| [0053](0053-mobile-venue-directory.md)                                | Mobile venue directory (Saha Rehberi): list, detail, reviews and suggestions                  | Accepted                                    |
| [0054](0054-mobile-profile-and-settings.md)                           | Mobile profile, statistics and settings, including account deletion                           | Accepted                                    |
| [0055](0055-public-pages-render-per-request-with-nonce.md)            | Public pages render per request with the nonce CSP; data may be cached, HTML is not           | Accepted                                    |
| [0056](0056-marketing-shell.md)                                       | Marketing shell: one server-rendered frame, brand tokens, links only to existing pages        | Accepted                                    |
| [0057](0057-programmatic-seo-pages.md)                                | Programmatic SEO pages: venue and district pages from cached public reads                     | Accepted                                    |
| [0058](0058-invite-landing-and-app-link-files.md)                     | Invite landing page and verified app link files                                               | Accepted                                    |
| [0059](0059-web-quality-gates.md)                                     | Web quality gates: WOFF2 fonts, JSON-LD and accessibility suites, Lighthouse CI               | Accepted                                    |
| 0060                                                                  | Reserved for Phase 4 (not used)                                                               | Proposed                                    |
| 0061                                                                  | Reserved for Phase 4 (not used)                                                               | Proposed                                    |
| 0062                                                                  | Reserved for Phase 4 (not used)                                                               | Proposed                                    |
| [0063](0063-revenuecat-webhook-and-entitlement-contract.md)           | RevenueCat webhook, reconciliation and entitlement contract                                   | Accepted                                    |
| [0064](0064-admin-api-and-totp-enrollment.md)                         | Admin API surface, TOTP enrollment and step-up                                                | Accepted                                    |
| [0065](0065-server-side-pro-entitlement.md)                           | Server-side Pro entitlement and statistics tiers                                              | Accepted                                    |
| [0066](0066-staff-totp-verification-and-step-up.md)                   | Staff TOTP verification, enrollment and step-up                                               | Accepted                                    |
| [0067](0067-admin-moderation-and-venue-import.md)                     | Admin moderation actions and the venue import job                                             | Accepted                                    |
| [0068](0068-admin-web-panel.md)                                       | Admin web panel                                                                               | Accepted                                    |
| 0069                                                                  | Reserved for Phase 5 (not used)                                                               | Proposed                                    |
| 0070                                                                  | Reserved for Phase 5 (not used)                                                               | Proposed                                    |
| 0071                                                                  | Reserved for Phase 5 (not used)                                                               | Proposed                                    |
| 0072                                                                  | Reserved for Phase 5 (not used)                                                               | Proposed                                    |
| 0073                                                                  | Portfolio delivery scope (Phase 6); reserved, no record yet                                   | Proposed                                    |
| 0074                                                                  | Error monitoring with Sentry and event scrubbing (Phase 5 exception); reserved, no record yet | Proposed                                    |
| [0075](0075-mobile-deep-links-and-push-handling.md)                   | Mobile deep links and push notification handling                                              | Accepted                                    |
| [0076](0076-mobile-maestro-e2e.md)                                    | Mobile end-to-end flows with Maestro on Android                                               | Accepted (flows not yet run on a device)    |
| [0077](0077-mobile-paywall-and-pro-gating.md)                         | Mobile paywall, purchase flows and Pro gating                                                 | Accepted (not verified against real stores) |
| [0078](0078-braces-advisory-exception.md)                             | Documented exception for the braces advisory GHSA-vfj7-8cjw-p6xm                              | Accepted                                    |
| [0079](0079-contract-follow-ups-entitlements-and-application-push.md) | Required profile entitlements and the match id in application notifications                   | Accepted                                    |
| [0080](0080-blog-and-legal-pages.md)                                  | Blog and legal pages: content files rendered to React elements, sample labels on legal text   | Accepted                                    |
| [0081](0081-cost-guard-usage-thresholds.md)                           | `cost.guard` usage thresholds and send gates                                                  | Accepted                                    |
| [0082](0082-revenuecat-subscriber-deletion-and-backup-verify.md)      | RevenueCat subscriber deletion at hard delete, and `backup.verify`                            | Accepted                                    |
| [0083](0083-faq-page-and-card-images.md)                              | FAQ page and Open Graph card images                                                           | Accepted                                    |

ADRs 0003–0027 record the authorization and domain-integrity decisions behind
`docs/security/authorization-matrix.md`. Schema consequences for `packages/db`: `matches.locked_at`
(0004), partial unique index for one captain per team (0008), unique
`open_call_applications(open_call_id, user_id)` (0010), `team_invites.code_hash` instead of `code`
(0011), `refresh_tokens.client` (0014), one `player_level` enum (0017).

ADRs 0028–0041 record the Phase 2 domain, worker, upload, notification and deletion decisions.
Schema consequences (handoff `docs/handoffs/decisions-to-db-001.md`): `job_receipts` (0028),
`uploads` (0030), `deletion_requests.external_pending` (0032), `users.is_tombstone` (0033),
`match_rsvps.waitlisted_at` (0035), `venues.search_name` with `pg_trgm` (0039).

Numbers 0045-0074 were reserved ahead of the parallel Phase 3-5 work so that no two branches
pick the same number: 0045-0046 for the preparation wave, 0047-0054 for Phase 3, 0055-0062 for
Phase 4, 0063-0072 for Phase 5, 0073 for the portfolio delivery scope and 0074 for error
monitoring. Phase 6 records started at 0075 (0075-0083 exist on `main`). A row without a link is a number
that has no record: 0060-0062 and 0069-0072 stayed unused inside their ranges, 0073 and 0074 are
still waiting for their record. Reserved numbers are not reused for other topics.

The Status column is updated when a decision is implemented and merged to `main`. "Accepted" means
the decision is in the code on `main`; where the evidence has a known limit (0076, 0077) the limit
is written next to the status.

**Next free number: 0084.**
