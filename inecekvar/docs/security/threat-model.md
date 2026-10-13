# Threat model outline

Controls and tests below are planned requirements, not completed implementation. Each phase is the primary delivery milestone; phase 6 repeats the complete attack suite, web/PWA and API scans, native assessment and retesting.

## GPS trace privacy

- Attack path: An unauthorized caller substitutes a trace identifier or extracts private points from public versions, packs or exports.
- Control: Restrict private reads to the owner and moderation roles; omit raw trace fields from every public response; delete traces 30 days after publication; omit trace bodies from logs and round coordinates to three decimals.
- Planned test: Read another owner's trace under every role; inspect nested public responses and logs; advance retention time and verify deletion.
- Phase: planned: phase 2.

## Data poisoning

- Attack path: A contributor submits fabricated fares, oversized traces, invalid geometry or coordinates outside the city boundary.
- Control: Require licence acceptance, provenance and moderation; enforce coordinate, fare, string, geometry, body-size and 5,000-point bounds; clearly label sample data. Use bound database parameters.
- Planned test: Submit malformed geometry, excessive points, out-of-bounds coordinates, unknown fields and injection strings; assert rejection without publication.
- Phase: planned: phase 2.

## Sockpuppet approval

- Attack path: Multiple accounts build reputation or approve a submission through a second identity.
- Control: Enforce server-side author/reviewer separation, contribution quotas, account controls and attributable audit records.
- Planned test: Attempt self-approval and linked-account approval; confirm contributor roles cannot approve and review suspicious reputation patterns.
- Phase: planned: phase 2.

## Planner denial of service

- Attack path: Pathological origins, destinations or graph inputs exhaust CPU or memory.
- Control: Limit requests to 30/min per trusted client IP; bound body size, city bounds and transfers to two; enforce a three-second timeout and reduced-capacity results when CPU capacity is constrained.
- Planned test: Flood requests, submit inputs outside the city boundary and pathological graphs; verify 429, timeout and degraded responses.
- Phase: planned: phase 2; cost-triggered degradation verification in phase 6.

## PMTiles egress

- Attack path: Hotlinking and repeated archive downloads exhaust bandwidth or budget.
- Control: Use CDN caching, download quotas and cost monitoring; measure archive size and request behaviour before deployment. Cloud storage and live egress remain external gates.
- Planned test: Repeat and hotlink downloads; verify cache behaviour, quota enforcement and cost-alert thresholds.
- Phase: planned: phase 6.

## Plugin permission bypass

- Attack path: A native plugin obtains location or credentials beyond intended permissions.
- Control: Use a narrow plugin allowlist, foreground-only location and Keychain/Keystore refresh storage; disable cleartext transport and review selected plugin versions.
- Planned test: Inspect native permissions and plugin inventory; deny location and background access; verify no refresh credentials appear in preferences or logs.
- Phase: planned: phase 3.

## SSR cache poisoning

- Attack path: Stored notes inject markup into SSR output, or attacker-controlled host headers and query values poison shared cache entries.
- Control: Render notes as plain text, escape SVG text, permit only numeric server-built map geometry and use per-request CSP nonces. Normalize cache keys and trusted hosts; exclude personalized responses and keep API responses no-store.
- Planned test: Render script and SVG payloads on SSR, web and PWA; vary host/query headers and users; verify escaped output, isolated cache entries, nonce handling and security headers.
- Phase: planned: phase 4; full injection sweep in phase 6.

## Account deletion

- Attack path: Deletion leaves private traces, tokens, photos, logs, subscription records or backup copies accessible.
- Control: Reauthenticate; immediately deactivate and revoke credentials, delete private traces and favorites and withdraw pending edits. After seven days remove personal rows and photos, remove the subscriber and anonymize licensed contributions; document backup expiry. A login during the grace period cancels final deletion.
- Planned test: Exercise immediate deletion, grace-period cancellation and final deletion; inspect storage, credentials and backups for residual personal data and retention behaviour.
- Phase: planned: phase 2; subscription deletion implemented in phase 5 against a transport double (`api/tests/deletion/test_subscriber_rest.py`, ADR-0050); backup checks in phase 6.

## CSRF in cookie mode

- Attack path: A hostile page submits a mutation using the victim's session cookie.
- Control: Use the Secure, HttpOnly, SameSite=Lax, Path=/ session cookie and require a validated double-submit X-CSRF-Token header on cookie-mode mutations.
- Planned test: Send missing, mismatched and cross-site CSRF requests; expect 403 and assert cookie attributes.
- Phase: planned: phase 1.

## Capacitor and CORS

- Attack path: A hostile origin reads credentialed responses or a native origin uses cookie authentication.
- Control: Allow only https://inecekvar.app, https://app.inecekvar.app, capacitor://localhost and https://localhost; local HTTP ports 4200/8100 only in local mode. Allow credentials only for the two web origins; native origins are bearer-only; explicitly list methods and headers without wildcards.
- Planned test: Check preflight and actual requests for every origin; hostile origins receive no CORS headers; reject native cookie-mode authentication.
- Phase: planned: phase 1; native runtime checks in phase 3.

## Webhook forgery

- Attack path: A forged or replayed RevenueCat event changes subscription access, or a forged Resend event suppresses email.
- Control: Compare the RevenueCat Authorization secret in constant time, reject unknown subscriber IDs and deduplicate event.id. Verify Resend Svix signatures over the raw body with a five-minute timestamp tolerance and deduplicate svix-id. Queue verified events within two seconds and reconcile subscriptions nightly. Resolve the account among `app_user_id`, `original_app_user_id` and `aliases` (one account only). Reconciliation downgrades a listed product the Plus entitlement no longer names, never re-activates a refunded lifetime row, isolates one failing subscriber, stops on a refused key and backs off on 429. Suppress only on a `Permanent` bounce, clear a bounce on a later delivery, retry security mail 30 days after a bounce (3 per address per day) and let an admin with a fresh step-up lift an entry (ADR-0050 items 3, 8, 11 to 13, 17).
- Planned test: Try missing/wrong secrets, tampered Resend bodies, stale timestamps, repeated IDs and unknown subscribers; verify no duplicate effects or unauthorized state changes.
- Executed: `api/tests/webhooks/test_revenuecat_webhook.py` and `test_resend_webhook.py` (missing, wrong, prefixed and truncated secrets, Svix headers missing, wrong key, tampered body, stale and future timestamps, unknown signature version, replayed and concurrently delivered ids, unknown, anonymous and missing subscribers, oversized bodies, wrong content types, credentials of the other provider, constant-time comparison spies, the published Svix example signature); the job applies each stored event once (`tests/billing/test_events.py`). Phase 5 review: `tests/billing/test_reconcile_downgrades.py` (dropped and expired entitlement, refunded lifetime, error boundary, provider clock, 401 stop, 429 backoff and cap), alias resolution and transfer without a key in `tests/billing/test_events.py`, bounce kinds and delivery in `test_resend_webhook.py`, the mail matrix and the SMTP discard session in `test_suppressed_mail.py`, `tests/security/test_admin_suppressions.py`, the 411 length check in `test_revenuecat_webhook.py`; every fix was reverted once and its test went red (ADR-0050). Not exercised: payloads signed by the real providers.
- Phase: implemented: phase 5 (ADR-0050).

## Pack entitlement bypass

- Attack path: A caller changes a subscriber identifier or invokes pack downloads directly to obtain extra cities without Plus.
- Control: Determine identity and first-city history on the server; verify active entitlement for additional cities; enforce quotas and reconcile subscription state. Never trust client purchase flags.
- Planned test: Download a second city anonymously and without Plus; forge identity and purchase flags; test expired and revoked subscriptions and concurrent requests.
- Executed: `api/tests/billing/test_entitlement_matrix.py` (free tier, active, lifetime, cancelled within and after the paid period, grace within and after, expired, refunded, another account's Plus, anonymous caller on the same network), out-of-order and transfer events (`test_events.py`), reconciliation that never downgrades on provider errors (`test_reconciliation.py`). The app sends no purchase flag the API reads. Not exercised: a real store purchase.
- Phase: implemented: phase 5 (ADR-0050).

## Refresh token reuse

- Attack path: A stolen refresh credential is replayed after rotation or races a legitimate refresh.
- Control: Store token hashes, rotate atomically and revoke the entire token family on reuse; keep native refresh credentials in secure storage and access tokens in memory for 15 minutes.
- Planned test: Reuse an old token, race two refresh requests and retry after logout; verify family revocation and the 30-day refresh expiry.
- Phase: planned: phase 1.

## Magic link interception

- Attack path: A leaked email link, log entry or replay authenticates an attacker.
- Control: Store only a SHA-256 token hash; enforce expiry and atomic single use; avoid auth bodies and tokens in logs, use HTTPS and limit link requests with generic responses.
- Planned test: Use an expired link, redeem twice and race redemption; inspect logs and error responses for secrets and account enumeration.
- Phase: planned: phase 1.

## Moderator collusion

- Attack path: A moderator asks another reviewer to approve their own proposal, bypassing a simple self-approval check.
- Control: Keep the direct author/reviewer prohibition; record both identities and diff hashes; detect reciprocal approvals and linked identities, route flagged cases to an independent reviewer and retain an attributable conflict decision.
- Planned test: Attempt direct and reciprocal approval with two moderators, including linked accounts; verify flagged proposals cannot publish until independent conflict review.
- Phase: planned: phase 2.

## Photo upload abuse

- Attack path: A disguised file passes a claimed image MIME type or embedded EXIF reveals a contributor's location.
- Control: Accept JPEG/WebP only, check magic bytes, bound presigned uploads to 4 MB and 20/day per user; quarantine failures; re-encode to WebP at 1600 pixels and strip metadata before publication. Traces use validated JSON, never file uploads.
- Planned test: Upload mismatched MIME/magic bytes, oversized files, malformed images and GPS EXIF; verify rejection/quarantine and no metadata in stored public images.
- Phase: planned: phase 2.

## Object authorization bypass

- Attack path: A caller substitutes profile, edit, favorite or administrative identifiers to read or mutate another account's resources.
- Control: Enforce the authorization matrix in API services using stored ownership and roles; require a 15-minute TOTP step-up for administrative and destructive moderation actions; audit decisions.
- Planned test: Test every role/action pair with another owner's identifiers, forged ownership and missing/expired step-up; moderators cannot manage users.
- Phase: planned: phase 1; domain checks in phase 2 and administrative checks in phase 4.

## Rate-limit and token tampering

- Attack path: Spoofed forwarding headers bypass quotas or altered JWT claims elevate privileges.
- Control: Trust client-IP headers only from the reverse proxy; limit authentication by IP and normalized email; verify JWT signature, algorithm, expiry and identity before role checks.
- Planned test: Spoof forwarding headers, alter role/subject/signature and submit expired tokens; verify quota enforcement and authentication rejection, including the sixth login attempt in 15 minutes.
- Phase: planned: phase 1.

## Secret exposure and recovery failure

- Attack path: Exposed credentials, unsafe logs, vulnerable dependencies or unusable backups expand a compromise.
- Control: Keep secrets outside client bundles and repository content; hash passwords with Argon2id and encrypt TOTP secrets; scrub logs and generic errors; scan dependencies; encrypt backups with 30-day retention and verify restoration. Historical secret cleanup requires separate authorization and credential rotation.
- Planned test: Inspect bundles, database hashes, forced-error responses and sanitized logs; run secret/dependency checks and a restore drill with geometry assertions.
- Phase: planned: phase 6; secret, password and logging controls begin in phase 1.
