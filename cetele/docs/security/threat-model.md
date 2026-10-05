# Çetele — Threat Model

|                     |                                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status              | **OUTLINE (Phase 0).** Threats, assets, entry points and planned mitigations are named. Nothing in this document is implemented or tested yet; every row is a plan until its proof phase (`not exercised: no code exists for these mitigations`). |
| Method              | STRIDE per threat for the nine threats listed in product spec section 6 item 23. Mitigations reference checklist item numbers (`#n`) of spec section 6.                                                                                           |
| Companion documents | [authorization-matrix.md](authorization-matrix.md) (who may do what), [verification-matrix.md](verification-matrix.md) (23 items), [ADR-0004](../adr/0004-portfolio-delivery-scope.md) (what cannot be exercised).                                |
| Review cadence      | Updated at every phase gate. A new endpoint, job or third-party integration needs a row or a row change here before it ships.                                                                                                                     |

---

## 1. System overview

An Android app (Compose, Room with SQLCipher, outbox sync) talks to one Spring Boot server over
HTTPS (`/v1`). The server holds PostgreSQL 16, an S3-compatible bucket for photos and, through
provider adapters, an SMS gateway and the Google Play APIs. The same server renders the public
statement page (`GET s/{token}`) and the admin console. Customers of a shop are not users: they
receive SMS or WhatsApp messages and may open a statement link.

## 2. Assets

| #   | Asset                                                                 | Why it matters                                                                  |
| --- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A1  | Ledger data: customers, phones, notes, entries, balances              | Personal and financial data of a small business and its customers (KVKK scope). |
| A2  | Tenant boundary: one shop must never read or write another shop       | Every other asset depends on it.                                                |
| A3  | Accounts and sessions: OTP codes, access JWT, refresh tokens, app PIN | Account takeover exposes A1.                                                    |
| A4  | SMS budget: provider credit, shop quota, daily cap                    | Direct money loss and sender-name reputation.                                   |
| A5  | On-device database and its key                                        | A lost or rooted phone holds a full ledger.                                     |
| A6  | Statement link tokens                                                 | A token is a bearer credential for one customer statement.                      |
| A7  | Entitlement: `plan`, `subscriptions`, `webhook_events`                | Paid features must follow real purchases only.                                  |
| A8  | Photos of handwritten notes and receipts                              | May contain names and amounts.                                                  |
| A9  | Admin console and `admin_users`                                       | Platform-wide read access to metadata.                                          |
| A10 | Secrets: JWT key pair, OTP pepper, DB, S3, SMS and Play credentials   | Their loss breaks every control above.                                          |

## 3. Trust boundaries and entry points

| #   | Entry point                                                | Caller                           | Boundary crossed                    |
| --- | ---------------------------------------------------------- | -------------------------------- | ----------------------------------- |
| E1  | `POST auth/otp/request`, `auth/otp/verify`, `auth/refresh` | Anyone on the internet           | Internet to server, no identity yet |
| E2  | Tenant endpoints under `shops/{id}/**`                     | Authenticated member             | One tenant to the shared database   |
| E3  | `POST sync/push`, `GET sync/pull`                          | Authenticated member, any device | Device to server, batch input       |
| E4  | `GET s/{token}`                                            | Anyone holding a link            | Internet to one customer statement  |
| E5  | `POST webhooks/play-rtdn`, `webhooks/sms-dlr`              | Provider, or someone pretending  | Provider to server                  |
| E6  | `/admin/**`                                                | Platform staff                   | Staff browser to server             |
| E7  | The installed APK and the device storage                   | Device holder, possibly hostile  | Device to everything on it          |
| E8  | Presigned upload and download URLs                         | Anyone holding a URL             | Internet to object storage          |

## 4. Threat register

Columns: **Asset** is from section 2 and **Entry** from section 3 (shown above each table).
**Mitigation** names the spec item number (`#n`) and the planned design decision. **Residual risk**
is what stays after the planned mitigation; it is stated now so it is not discovered later.
**Proof phase** says when a test or artefact is planned; until then the row is a plan.

### 4.1 Tenant isolation

Asset A1, A2. Entry E2, E3, E4.

| STRIDE                 | Threat                                                                            | Mitigation (spec item)                                                                                                              | Residual risk                                                                                               | Proof phase |
| ---------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------- |
| Spoofing               | A member of shop A claims shop B by sending B's id in the path or body.           | `shop_id` derived from the caller's membership, never from the body; a non-member gets 404 (#3, #4).                                | A bug in one query that forgets the filter; covered only by the ArchUnit rule and the isolation tests.      | 1           |
| Tampering              | A write lands in another shop through a crafted foreign key (customer of shop B). | Every tenant query takes `shopId`; ArchUnit checks every tenant repository method (#4); composite ownership checks on foreign keys. | Raw SQL added later bypasses the rule unless item 15 bans it.                                               | 1           |
| Information disclosure | Cross-tenant read through guessing ids or through the sync cursor.                | UUIDv7 ids are not a secret and are not relied on; 404 for non-members; `since` cursor is per shop (#4).                            | Timing differences between 404 for absent and 404 for foreign are not measured.                             | 1, 6        |
| Elevation of privilege | A `STAFF` member performs an owner action.                                        | `PermissionEvaluator` on every endpoint and per sync operation; table-driven test over every cell (#3).                             | `EXPORT_ALL` has no server endpoint, so a staff member can read the whole ledger through sync (matrix D-5). | 1, 2        |

### 4.2 OTP brute force

Asset A3. Entry E1.

| STRIDE                 | Threat                                                            | Mitigation (spec item)                                                                                            | Residual risk                                                                                     | Proof phase |
| ---------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| Spoofing               | Guessing the 6 digit code for a victim's phone.                   | 5 attempts per code, then invalidated; 5 minute TTL; single use; `otp/verify` limited per phone and IP (#5, #11). | A targeted attacker can request new codes; the request limit of 3 per 10 minutes bounds the odds. | 1, 6        |
| Tampering              | Replaying an old code.                                            | Code stored as `HMAC-SHA256(pepper, phone + code)`, `consumed_at` set on success (#11).                           | A leaked pepper allows offline guessing of a stolen table; pepper is environment-only (#1).       | 1           |
| Information disclosure | Distinguishing known from unknown phones by response differences. | Uniform responses and timing-neutral handling on request and verify; masked logs (#13, #14).                      | Residual timing side channel not measured.                                                        | 6           |
| Denial of service      | Locking a victim out by spending their attempts.                  | Attempts are per code, not per account; a fresh code resets the counter within the request limit (#5).            | A victim can be slowed by request-limit exhaustion for their own phone.                           | 1           |

### 4.3 SMS pumping and toll fraud

Asset A4. Entry E1, E2.

| STRIDE            | Threat                                                                                   | Mitigation (spec item)                                                                                                        | Residual risk                                                                              | Proof phase |
| ----------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------- |
| Spoofing          | A script requests OTPs without being the app.                                            | `otp/request` requires a valid Play Integrity token; client IP from the trusted proxy header only (#5).                       | Integrity verdicts are not exercised against Google here (ADR-0004 G3); only fixtures.     | 1, 6        |
| Tampering         | Spoofed `X-Forwarded-For` to defeat the per-IP limit.                                    | Forwarded header trusted only from the reverse proxy; attack test with a spoofed header (#5, #23).                            | Misconfigured proxy in a real deployment is not testable here.                             | 1, 6        |
| Denial of service | Draining the SMS credit through reminders or OTP requests to premium or foreign numbers. | Per-shop monthly quota, global daily cap, E.164 validation limited to Turkish numbers, balance monitor with alerts (#6, #22). | A single abuser can still consume the daily cap and block legitimate sends until midnight. | 2, 6        |
| Repudiation       | A shop denies sending a reminder, or a customer denies consent.                          | `reminders` rows with status and provider id; consent flag, date and source stored per customer (spec section 3 story 6).     | Consent evidence is a record we keep, not a verified legal proof.                          | 2           |

### 4.4 IDOR

Asset A1, A8. Entry E2, E3, E8.

| STRIDE                 | Threat                                                               | Mitigation (spec item)                                                                                 | Residual risk                                                                                     | Proof phase |
| ---------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------- |
| Information disclosure | Reading a customer, entry, statement or photo of another shop by id. | Membership resolved before any lookup; 404 on mismatch; IDOR matrix in the attack suite (#3, #4, #23). | Photo object keys must embed the shop and be signed per request; a leaked URL works until expiry. | 1, 6        |
| Tampering              | Updating or reversing an entry that belongs to another shop.         | Same membership check on writes; reversal checks the original entry's `shop_id` (#4).                  | None beyond the shared-query risk in 4.1.                                                         | 2           |
| Elevation of privilege | `DELETE members/{userId}` used on a user outside the shop.           | The member must belong to the shop in the path; an unknown id is 404 (#3).                             | None known.                                                                                       | 1           |

### 4.5 Sync replay and tampering

Asset A1, A2. Entry E3.

| STRIDE                 | Threat                                                                     | Mitigation (spec item)                                                                                                                         | Residual risk                                                                                    | Proof phase |
| ---------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| Tampering              | A forged operation changes a closed ledger entry or a foreign `client_id`. | Ledger entries are append-only; `client_id` unique; the server checks the action per operation; amounts validated as `1..100_000_000_00` (#6). | A staff member with a valid token may legitimately write wrong entries; reversals leave a trail. | 2, 6        |
| Repudiation            | A device denies an operation it pushed.                                    | `sync_outbox_receipts` per device and `client_seq`; entries carry `created_by` (spec section 5).                                               | Device identity is only as strong as the Play Integrity evidence (ADR-0004 G3).                  | 2           |
| Denial of service      | Oversized or endless batches.                                              | Batch of at most 500 operations, body limit 1 MB, per-user limits (#5, #6).                                                                    | Slow pulls from a large ledger are limited by `limit=500` only.                                  | 1, 2        |
| Information disclosure | Replaying a pull cursor of another device to read changes.                 | Cursor is per shop and authenticated; no change is returned to a non-member (#4).                                                              | None known.                                                                                      | 2           |

### 4.6 Rooted-device data theft

Asset A5, A1, A3. Entry E7.

| STRIDE                 | Threat                                                              | Mitigation (spec item)                                                                                                                                | Residual risk                                                                                                          | Proof phase |
| ---------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------- |
| Information disclosure | Copying the Room database or the refresh token from a rooted phone. | SQLCipher with a key wrapped by the Android Keystore; refresh token in `EncryptedSharedPreferences`; `allowBackup=false` with extraction rules (#12). | A rooted, unlocked device can read memory while the app runs; a hardware-backed key is not guaranteed on every device. | 3, 6        |
| Elevation of privilege | Bypassing the app PIN or biometric lock.                            | PIN hashed with Argon2id on device, never sent to the server; lock after 2 minutes in background (#11, spec section 3 story 1).                       | PIN is six digits; offline guessing cost depends on Argon2id parameters and device speed.                              | 3           |
| Repudiation            | A stolen device keeps syncing after the owner has lost it.          | Device rows and revocation from the app and the admin console; access JWT 15 minutes (#12, #18).                                                      | Up to 15 minutes of access after revocation.                                                                           | 3, 4        |

### 4.7 Re-signed APK abuse

Asset A3, A4, A7. Entry E1, E7.

| STRIDE                 | Threat                                            | Mitigation (spec item)                                                                                                        | Residual risk                                                                                                  | Proof phase |
| ---------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------- |
| Spoofing               | A repackaged app calls the API and requests OTPs. | Play Integrity token required on `otp/request`; server checks package name and signing digest verdicts (#5).                  | Cannot be demonstrated without Play Console and a real token (ADR-0004 G3). Only fixtures prove the code path. | 1, 6        |
| Tampering              | Patched certificate pinning to intercept traffic. | `CertificatePinner` with primary and backup pins in release builds (#10); the server never trusts client-supplied roles (#4). | A rooted, instrumented device can still defeat pinning; server-side checks are the real defence.               | 3, 6        |
| Information disclosure | Extracting embedded secrets from the APK.         | The APK ships no secrets (#1); the API base URL is the only build-time value; R8 full mode.                                   | Public API shape remains visible by design.                                                                    | 3, 6        |

### 4.8 Statement link enumeration

Asset A6, A1. Entry E4.

| STRIDE                 | Threat                                                                | Mitigation (spec item)                                                                                                                    | Residual risk                                                                         | Proof phase |
| ---------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------- |
| Information disclosure | Guessing or brute-forcing tokens to read other customers' statements. | High-entropy random token stored as SHA-256 (#11); expiry; uniform 404; per-IP rate limit; token-guessing test in the attack suite (#23). | A link forwarded by the customer is readable by anyone who holds it until it expires. | 2, 6        |
| Information disclosure | Search engines or referrers leak the link.                            | `noindex`, `Referrer-Policy: strict-origin-when-cross-origin`, `Cache-Control: no-store` (#9).                                            | A link posted in a public chat is outside our control.                                | 2, 5        |
| Tampering              | Script injection through a customer or shop name shown on the page.   | `th:text` only, CSP with a per-request nonce (#9, #16).                                                                                   | A new template added without the unit test scan.                                      | 2, 6        |

### 4.9 Webhook forgery

Asset A7, A4. Entry E5.

| STRIDE            | Threat                                            | Mitigation (spec item)                                                                                                                         | Residual risk                                                                                          | Proof phase |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------- |
| Spoofing          | A forged RTDN grants a Pro plan.                  | Google-signed OIDC JWT with checked issuer, audience and service-account email; the purchase is re-verified with the Play Developer API (#17). | Real Google keys and Pub/Sub are not available here (ADR-0004 G2); proof uses a locally made key pair. | 4, 6        |
| Tampering         | Altering the body of a genuine delivery report.   | HMAC-SHA256 over the raw body in `X-Cetele-Signature` (#17).                                                                                   | The provider may not be able to sign (ADR-0003); the fallback is the provider report query.            | 4           |
| Repudiation       | Replaying an old notification to flip state back. | Idempotent by `messageId` and `webhook_events.event_id`; timestamp within five minutes; replay cache on `provider_msg_id` (#17).               | Cache loss on restart reopens a short replay window; the event table closes it for stored ids.         | 4, 6        |
| Denial of service | Flooding the endpoints.                           | Respond 200 fast and process asynchronously; source IP allowlist for the SMS provider; body limit (#17, #6).                                   | An allowlist needs provider IP ranges that are not verified here.                                      | 4           |

## 5. Cross-cutting threats (named, not analysed)

These are outside the nine required rows. Each is named so that it is not forgotten; none has a row
yet.

- Admin console takeover (A9): TOTP, role separation, audit log (#18); analysed in Phase 4.
- Photo upload abuse (A8): magic-byte check, re-encoding, quota (#7); analysed in Phase 2.
- Account and shop deletion that leaves data behind (A1): grace period and hard delete (#21);
  analysed in Phase 2 and Phase 6.
- Secret leakage through history or CI (A10): gitleaks, history purge runbook (#1, #2); Phase 6.
- Dependency vulnerabilities (all assets): dependency check and SBOM (#19); Phase 6.
- Backup theft or loss (A1): `age` encryption, separate write-only bucket (#20); Phase 6.

## 6. Evidence limits

Per [ADR-0004](../adr/0004-portfolio-delivery-scope.md): Play Integrity, RTDN signing, the SMS
provider, Play Billing, hosting and a signed build cannot be exercised against the real providers
here. Where a row depends on one of them, its proof is a fixture or a locally made key pair and the
row says so. No physical or rooted device is available; rooted-device behaviour is analysed on paper
and on the emulator only.
