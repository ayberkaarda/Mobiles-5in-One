# ADR-0004: Portfolio delivery scope and evidence limits

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner)

## Context

This repository is a portfolio project. Its goal is to demonstrate engineering quality: code,
tests, CI, architecture records and documentation, plus working local demos. It is not operated as
a commercial service: there is no legal entity, no Play Console account, no production domain and no
paid provider account. The specification nevertheless lists work that depends on such external
parties ("external gates"). This record states how those gates are handled so that every report
says exactly what was and was not exercised.

The development machine runs Windows with Docker and an Android emulator (AVD `Pixel_8`). There is
no physical device, no rooted device and no real provider key.

## Decision

1. External gates. A gate that needs an account, a physical device, a store or a real domain is not
   a blocker. It is exercised with fixtures, the emulator or a local look-alike (MinIO for
   S3-compatible storage, Mailpit for SMTP, Testcontainers PostgreSQL), or it is documented as a
   runbook.
2. Status reporting. A claim such as "passed" or "verified" always carries the command and its real
   output. A check that was not run is written as `not exercised: <reason>`. A feature verified only
   against a fake or fixture says so in the same sentence.
3. Matrix wording rule. The security verification matrix keeps the statuses `done`, `partial` and
   `not-started` and has an "Evidence limit / ADR" column.
   - `done`: implemented, and its verification was executed with real output.
   - `partial`: implemented or documented, but a part was not exercised; the column states which
     part and why.
   - `not-started`: nothing exists yet, or the row needs an account, a device or an environment that
     is not available, with a reason and an ADR reference.

   No report states "23/23 done" or that the Definition of Done is fully met while any row is
   `partial` or `not-started`; the report title says so.

4. Adapters. Production adapters (SMS, Play Integrity verdict, Play Developer API, mail, object
   storage) are written against the real provider interface. Fake transports (`FakeSmsGateway`, a
   fake integrity verifier, a fake Play client) are selectable only in the `local` and test
   environments, and startup validation rejects them elsewhere once the real adapter exists.
5. Sample content. Legal pages (privacy notice, terms, data-controller statement) are labelled as
   samples, name no real company, address or tax number, and claim no legal compliance. Sample
   shops and customers carry the prefix `[ÖRNEK]`.
6. Signing. No upload key, release keystore or Play App Signing enrolment exists. An unsigned
   release build is a Phase 3 artefact; a signed AAB is not produced.

## External gates

Classes: `K` exercised with a fixture, emulator or local substitute; `P` partly exercised (our own
consistency is proven, the provider is not); `N` not exercisable here (documented only).

| #   | Gate                                                                   | Proven here (when its phase is done)                                                          | Not exercised, and why                                                                                | Class |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----- |
| G1  | Play Billing and Play Developer API (`purchases.subscriptionsv2`)      | purchase linking logic and entitlement rules against recorded fixtures and a fake client      | live purchase and server verification: no Play Console account, no service account, no licence tester | P     |
| G2  | RTDN Pub/Sub push with the Google-signed OIDC JWT                      | verification code against a locally made key pair; replay and idempotency by `messageId`      | real Google signature, JWKS and Pub/Sub subscription: no Google Cloud project                         | P     |
| G3  | Play Integrity                                                         | verdict handling against fixtures; rate limits; app-side call behind an interface with a fake | real token: no Google Cloud project or Play Console link; re-signed APK abuse cannot be demonstrated  | P     |
| G4  | SMS provider ([ADR-0003](0003-sms-provider.md))                        | `SmsGateway` contract, `FakeSmsGateway`, quota and caps, DLR signature and replay tests       | any real SMS, balance query or delivery report: no provider account                                   | P     |
| G5  | Hosting, TLS, R2, DNS, backups on a host ([ADR-0002](0002-hosting.md)) | local compose stack, MinIO, `pg_dump` and restore into a Testcontainers database              | real host, certificate, HSTS preload, R2 token behaviour, pgBackRest on a VPS: no hosting account     | K / N |
| G6  | Signed release AAB                                                     | unsigned release assembly and an R8 mapping (Phase 3)                                         | signing, Play App Signing, upload: no keystore and no store account                                   | N     |
| G7  | App links on a live domain (`assetlinks.json`)                         | file format and schema checks with a debug-key fingerprint                                    | verification by Android against a real domain and signing fingerprint                                 | P     |
| G8  | Mail provider for cost alerts                                          | SMTP flow through Mailpit                                                                     | delivery and domain verification at the real provider: no account                                     | K     |
| G9  | Error reporting (Sentry)                                               | disabled mode without a DSN; scrubbing hook tests                                             | a real Sentry project: no account                                                                     | K     |
| G10 | Security scans (ZAP, MobSF, dependency audit, secret scan)             | run locally or in CI against the compose stack and the debug or unsigned release build        | MobSF on a signed store build: none exists; a scan not run in a phase is listed in that phase report  | K     |
| G11 | Device matrix                                                          | JVM unit tests, instrumented tests on the `Pixel_8` emulator                                  | physical devices, rooted-device behaviour and real GSM: none available                                | K / N |
| G12 | WhatsApp share                                                         | intent construction and message template tests                                                | a real WhatsApp client receiving the message                                                          | P     |
| G13 | Store listing, Data Safety, account-deletion declaration               | listing copy and field mapping written as documents (Phase 6)                                 | console entry and review: no Play Console account                                                     | K / N |
| G14 | Legal and accounting (KVKK texts, ledger retention)                    | sample-labelled legal pages                                                                   | any real legal review: not available; texts are samples, not legal advice                             | N     |
| G15 | Real shops and customer data                                           | `[ÖRNEK]` seed data                                                                           | real shop registration and real ledgers                                                               | K     |

Phase 0 exercised none of the gates. The foundation proves only that the projects build and that
their local checks run; each later phase report fills the "Proven here" column with commands and
output.

## Consequences

- Reports are longer but honest: every `partial` row lists its limit.
- Provider behaviour claimed in any ADR that was not checked is labelled "not verified" in that ADR.
- The real-world path (accounts, signing, domain, legal review) is written down in the release
  readiness documents of Phase 6.
- Moving to a real launch means replacing fakes with provider calls and re-running the matrix; rows
  marked `partial` become `done` only with new evidence.
