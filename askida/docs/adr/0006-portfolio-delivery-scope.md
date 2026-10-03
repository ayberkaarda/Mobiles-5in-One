# ADR-0006: Portfolio delivery scope and evidence limits

- Status: Accepted
- Date: 2026-10-03
- Deciders: Ayberk (owner)

## Context

This repository is a portfolio project. Its goal is to demonstrate engineering quality: code,
tests, CI, architecture records and documentation, plus working local demos. It is not operated as
a commercial service: there is no legal entity, no store listing, no production domain and no paid
provider account. The specification nevertheless lists work that depends on such external parties
("external gates"). This record states how those gates are handled so that every report says
exactly what was and was not exercised.

The development machine runs Windows with Docker and an Android emulator. There is no Mac and no
real provider account or key.

## Decision

1. External gates. The gates of this project are listed in the table below. A gate that needs an
   account, a physical device, a store or a real domain is not a blocker. It is exercised with
   fixtures, emulators, local look-alikes (for example MinIO for S3-compatible storage and a mail
   catcher for SMTP), or documented as a runbook.
2. Status reporting. The README status table has a "Not exercised" column. For every feature or
   check verified only against a fake, a fixture or a local substitute, the column names what was
   not exercised and why. A claim such as "passed" or "verified" always carries the command and its
   real output; a check that was not run is written as "not run".
3. Matrix wording rule. The security verification matrix keeps the statuses `done`, `partial` and
   `not-started`, and has one more column, "Evidence limit / ADR".
   - `done`: implemented, and its verification was executed with real output.
   - `partial`: implemented or documented, but the external part was not exercised; the column
     states which part and why.
   - `not-started`: only for a row that needs an account, a device or an environment that is not
     available, with a reason and an ADR reference.
     No report states "23/23 done" or that the original Definition of Done is fully met while any row
     is `partial` or `not-started`; the report title says so.
4. Adapters. Production adapters (payment, attestation, push, mail, storage, sign-in) are written
   against the real provider interface. Fixture or simulated transports are selectable only in the
   `local` and test environments; the configuration schema rejects them elsewhere.
5. Sample texts. Legal and company texts (privacy notice, data-controller statement, terms) are
   labelled as samples, name no real company, address or tax number, and claim no legal compliance.
   Sample shops exist only as `is_sample = true` rows with the name prefix `[ÖRNEK]`.
6. iOS. The iOS build and simulator tests need macOS. The iOS folder is created by the Flutter
   tool but never built here, and the Swift attestation channel file is written but not compiled.
   No report says "iOS green" without a macOS run. Whether to run a macOS CI job (manual
   dispatch) is a cost decision for the owner.

## External gates

Classes: `K` exercised with a fixture, emulator or local substitute; `P` partly exercised (our own
consistency is proven, the provider is not); `N` not exercisable here (documented only).

| #   | Gate                                                                 | Proven here                                                                                                                         | Not exercised, and why                                                                                                                                 | Class |
| --- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| G1  | iyzico sandbox: checkout token, sub-merchant, retrieve, webhook sign | `PaymentGateway` contract; fake-HTTP fixtures of responses; webhook signature self-consistency with a local key; amount from server | live sandbox call: no account or keys; signature scheme and marketplace sandbox access not verified                                                    | P     |
| G2  | Play Integrity                                                       | Kotlin channel unit test with a fake integrity manager; mocked Dart channel; server verdict fixtures; limits and caching            | real token: no Google Cloud project or Play Console link; emulator behaviour not verified                                                              | P     |
| G3  | DeviceCheck (iOS)                                                    | server-side token validation against fake HTTP with a locally made key                                                              | Swift channel never compiled or run: no macOS or Apple account; DeviceCheck is not an app-integrity proof (App Attest is an alternative, not in scope) | P / N |
| G4  | Firebase FCM and APNs push                                           | push transport interface, `log` transport, queue jobs, payload shape and anonymity tests, fan-out cap (ADR-0004)                    | real delivery: no Firebase project, no APNs key                                                                                                        | P     |
| G5  | Error reporting (Sentry)                                             | disabled mode without a DSN; scrubbing hook test                                                                                    | real Sentry project: no account (Crashlytics is not in scope)                                                                                          | K     |
| G6  | Map tiles (ADR-0003)                                                 | map widget tests with a fake tile provider; PostGIS distance queries on a real container; emulator mock location                    | tile server traffic and policy compliance; production PMTiles archive                                                                                  | K     |
| G7  | Mail (Resend)                                                        | SMTP flow through mailpit; mail fakes in tests                                                                                      | Resend delivery and domain verification: no account                                                                                                    | K     |
| G8  | Object storage (R2) and backups                                      | MinIO: private disk, short-lived signed URLs, MIME and magic-byte rejection, backup bucket, restore drill                           | real R2 and write-only token behaviour: no account                                                                                                     | K     |
| G9  | Sign in with Apple and Google                                        | server token validation with fixture JWTs and a fake key set; app provider interface with a fake                                    | real sign-in: no Apple or Google client registration                                                                                                   | P     |
| G11 | iOS build and simulator tests                                        | Android: emulator, `flutter test`, `integration_test`, debug build                                                                  | iOS build and tests: no macOS runner decided or available                                                                                              | K / N |
| G12 | Store listings, Data Safety, App Privacy                             | ASO text and field mapping written as documents                                                                                     | console entry and review: no developer accounts                                                                                                        | K / N |
| G13 | Domain: HSTS preload, app-link files, rich results, TLS              | file format and schema tests; sample assetlinks with a debug key fingerprint; `caddy validate`; local Lighthouse run                | real domain, DNS, certificate, signing fingerprint, preload list                                                                                       | P     |
| G14 | Security scans (ZAP, MobSF, dependency audit, secret scan)           | run locally or in CI against the compose stack and the debug APK                                                                    | MobSF on an IPA: no IPA exists                                                                                                                         | K     |
| G15 | Legal and accounting (marketplace agreement, retention, KVKK texts)  | open question in ADR-0005; sample-labelled legal pages                                                                              | any real legal or accounting review: not available; texts are samples, not legal advice                                                                | N     |
| G16 | Real merchants and shop data                                         | `[ÖRNEK]` seed rows with `is_sample = true`                                                                                         | real merchant registration and admin verification of a real business                                                                                   | K     |
| G17 | Anonymous-device farming                                             | server counters, limits, bans and a parallel reserve race test on real PostgreSQL                                                   | many real devices or emulators attacking at once: not simulated; real strength of the protection is not proven                                         | P     |
| G18 | Redis, Horizon, PostGIS, PostgreSQL 16                               | Docker Compose services and tests against them                                                                                      | none beyond single-host scale                                                                                                                          | K     |

G10 (SMS) does not apply: the specification has no SMS feature, so the number is unused.

## Consequences

- Reports are longer but honest: every `partial` row lists its limit.
- Provider behaviour claimed in any ADR that was not checked is labelled "not verified" in that ADR.
- The real-world path (accounts, signing, domain, legal review) is written down in the release
  readiness documents of Phase 6.
- Moving to a real launch means replacing fixtures with provider calls and re-running the matrix;
  rows marked `partial` become `done` only with new evidence.
