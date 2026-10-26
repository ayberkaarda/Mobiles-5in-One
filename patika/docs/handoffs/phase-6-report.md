# Patika — Phase 6 Report
## Summary (5 lines max)
Phase 6 hardens the stack and closes the project: client-address trust for the admin BFF, CSP and isolation headers, stored-text cleaning with a sweep over every rendering surface, split email and push budgets with alerts, backups with a restore drill, release documents, ZAP and MobSF scans, the pentest report and the final 23-item matrix (19 done, 4 partial, 0 not applicable).
Everything ran locally (Docker, the Android emulator); Google Play, Pub/Sub, FCM, Resend, hosting and TLS are simulated or absent, as the matrix states row by row.
This is the final report; there is no phase 7.

## Files created / modified (grouped by owner, full paths)
- lead: `patika/README.md`, `patika/README.tr.md`, `patika/docker-compose.yml`, `patika/.env.example`, `patika/.gitignore`, `patika/docs/handoffs/phase-6-report.md`, root `README.md`, `README.tr.md`, `docs/readme/patika.png`
- api: `patika/src/Patika.Api/**` (BFF settings and `/health/bff`, trusted proxies, email budgets and `email_unavailable`, `RequestText` filter, JSON encoder, OpenAPI only in Development or with `OpenApi:Enabled`), `patika/src/Patika.Infrastructure/**` (logging masks moved here, `UserText.Clean`, cost guard, retention, migration `Phase6FanoutDeferral`, blank storage settings), `patika/src/Patika.Worker/**` (`backup.verify`, deferred urgent fan-out, ops alerts), `patika/tests/Patika.Api.Tests/**`, `patika/tests/Patika.Worker.Tests/**`, `patika/tests/Patika.Domain.Tests/**`
- web: `patika/src/Patika.Web/**` (persistent key ring, BFF self-check, CSP with `form-action`, COOP, CORP, no `Server` header, admin mobile menu, Html.Raw ban), `patika/tests/Patika.Web.Tests/**`
- mobile: `patika/app/Patika.App/**` (explicit `exported`, cleartext off, backup and device-transfer rules), `patika/tests/Patika.App.Tests/**`
- security: `patika/docs/security/hardening.md`, `pentest-report.md`, `verification-matrix.md`, `scans/zap.md`, `scans/mobsf.md`, `threat-model.md`, `history-purge-runbook.md`, `patika/tests/Patika.SecurityTests/**`, `patika/ops/backup/**`
- ops and release: `patika/docs/ops/env.md`, `cost-alerts.md`, `logging.md`, `backup-restore.md`, `patika/docs/release/play-listing.md`, `data-safety.md`, `signing.md`, `play-assets/**`
- qa and CI: `.github/workflows/patika-ci.yml` (vulnerable-package gate, SBOM, marker grep, release manifest check, ZAP baseline job), `.github/workflows/patika-restore-drill.yml`, `.github/dependabot.yml`, `patika/ops/ci/**`

## Decisions & ADRs added
No new ADR. Decisions recorded in the docs:
- CSP `script-src 'self'` without a nonce: the Web ships no script, so public HTML stays cacheable ([hardening.md](../security/hardening.md)).
- The admin cookie stays path-scoped (`Path=/admin`), so the `__Host-` prefix is not used ([verification-matrix.md](../security/verification-matrix.md), item 12).
- COEP stays off; COOP and CORP are `same-origin` ([pentest-report.md](../security/pentest-report.md), P6C-08).
- Security email (codes, reset, deletion) never counts against the non-critical email cap and has its own budget; urgent pushes past the cap are deferred, not dropped ([cost-alerts.md](../ops/cost-alerts.md)).
- `/openapi.json` is served only in Development or with `OpenApi:Enabled=true`.
- The ZAP API scan stays a manual command: with the real rate limits it takes about 75 minutes. The ZAP baseline runs in CI.
- minSdk stays 24 (MobSF M1, accepted).

## Security checklist status
| # | Item | Status (done / partial / not-started) | Evidence (test name, doc path) |
|---|---|---|---|
| 1 | Keys out | done | gitleaks in `Patika secret scan`; MobSF secret review; `docs/ops/env.md` |
| 2 | History purge | done | `docs/security/history-purge-runbook.md`; full-history gitleaks clean, nothing to purge |
| 3 | Permission rules | done | `PermissionsMatrixTests`; `docs/security/authorization-matrix.md` |
| 4 | Server-side authorization | done | `IdorTests`, `CommunityIdorTests`, `MeReadModelIdorTests`, `AdoptionAccessTests` |
| 5 | Sign-in limits | done | `RateLimitTests`, `EmailCodeBruteForceTests`, `BffConfigurationTests` |
| 6 | Input validation | done | `ValidatorTests.EveryRequestDtoHasAValidator`, `HttpBaselineTests`, `RequestTextTests` |
| 7 | Upload limits | done | `PresignStorageTests`, `ImageSanitizerTests`, `MinioPipelineTests` |
| 8 | CORS | done | `HttpBaselineTests.CorsIsOffByDefault` |
| 9 | Security headers | done | `HttpBaselineTests`, `NetworkHardeningTests`; ZAP baseline 0 high, 0 medium |
| 10 | HTTPS | partial | Release cleartext off (MobSF, CI manifest check); no deployed proxy or TLS, no pinning |
| 11 | Password hashing | done | `PasswordHashingTests` |
| 12 | Secure cookie and tokens | done | `AdminBoundaryTests`, `AdminFlowTests`, `TokenAttackTests`; device token storage check |
| 13 | Short errors | done | `HttpBaselineTests.ForcedServerErrorReturnsOnlyGenericTitleCodeAndTraceId` |
| 14 | Clean logs | done | `LoggingTests`, `WorkerHostLoggingTests`, `WebHostHardeningTests`; logcat 0 token matches |
| 15 | Parameterized queries | done | BannedApiAnalyzers with `BannedSymbols.txt`; ZAP SQL injection rules pass |
| 16 | XSS | done | `StoredTextSafetyTests.ApiStoredTextStaysInertAcrossPublicAdminSeoAndJson`, PATIKA001 |
| 17 | Webhook signature | partial | `PushSignatureTests`, `PushKeyTests`, `VerificationTests`; Play and Pub/Sub simulated |
| 18 | Admin roles | done | `AdminFlowTests`, `StepUpTests`, audit tests |
| 19 | Package audit | done | `Check vulnerable packages`, `patika-sbom`, Dependabot |
| 20 | Automatic backup | partial | `ops/backup/*`, `patika-restore-drill.yml`, `BackupVerifyTests`; no bucket or schedule in production |
| 21 | Account deletion | done | `AccountDeletionTests`, `HardDeleteLeavesNoPersonalDataTests` |
| 22 | Spend alerts | done | `docs/ops/cost-alerts.md`, Worker `PushTests`, `EmailBudgetTests`, `OpsAlertTests` |
| 23 | Attacker-style testing | partial | attack suite, ZAP, MobSF, `docs/security/pentest-report.md`; ZAP API scan manual, not in CI |

Full evidence: [`docs/security/verification-matrix.md`](../security/verification-matrix.md).

## SEO/GEO status (Phase 4+)
Unchanged since phase 4 and still in place: Turkish titles and descriptions, canonical and hreflang, sitemap index with honest `lastmod`, JSON-LD (Organization, MobileApplication for Android, VeterinaryCare and AnimalShelter, BreadcrumbList, FAQPage, Article) with a safe serializer, `llms.txt`, five guides, the impact page, Lighthouse 99 to 100 on seven pages at the phase 4 gate. Phase 6 added `form-action`, COOP and CORP headers; the CSP check in Chromium showed 0 violations and every JSON-LD block parsed. Lighthouse was not rerun in this phase.

## Tests executed (command + result counts)
- `dotnet test Patika.slnx` (Docker running): Api 511, App 223, Domain 51, Security 480 + 2 skipped, Web 123, Worker 68: 1,456 passed, 0 failed.
- The 2 skipped `AdoptionPersistenceTests`: `PATIKA_TEST_DB=<migrated PostGIS>` `dotnet test tests/Patika.SecurityTests --filter AdoptionPersistenceTests`: 2 passed.
- `dotnet format Patika.slnx --verify-no-changes`: exit 0.
- `dotnet build app/Patika.App/Patika.App.csproj -f net10.0-android -c Release`: 0 warnings, 0 errors.
- `docker compose up --build` (Staging) and ZAP: baseline on the Web and `/admin/giris`, API scan unauthenticated and authenticated ([scans/zap.md](../security/scans/zap.md)).
- MobSF v4.5.3 on the Release APK and the emulator checks ([scans/mobsf.md](../security/scans/mobsf.md)).
- Mutation checks in this package: blank storage values (`PhotoUrlResolverTests` fails), the `Server` header (`WebHostHardeningTests` fails), the NUL check (3 `RequestTextTests` cases fail).
- gitleaks 8.30.1 on the branch: no leaks. actionlint 1.7.7 and shellcheck 0.11: clean.

## Known gaps / risks
- Partial matrix rows 10, 17, 20 and 23 (see the matrix for what is simulated).
- Accepted findings P4-20, P5-07, P5-22, P6-18 to P6-20 and P6C-07 to P6C-11 and P6C-13 ([pentest-report.md](../security/pentest-report.md)).
- Breaking configuration for an operator: `Network:KnownProxies` and `KnownNetworks` are no longer read; the BFF needs a fixed Web address and a key of 32 characters or more.
- The email cap documentation assumes one API instance (the per-recipient limit is in memory).

## Open questions / proposals (scope, cost, legal)
Only relevant if Patika is ever launched: a domain and TLS, a Play Console app (signing, Billing, RTDN through Pub/Sub), Firebase for FCM, a Resend account, an R2 bucket for photos and backups, a Google Maps key, and a legal review of the draft texts.

## Proposed Conventional Commits (not executed)
Executed instead, one-line commits on `feat/patika-p6`; the pull request is titled `feat(patika): hardening, scans and release readiness`.

## Next phase preview (3 lines)
None: phase 6 is the last planned phase.
Further work would start with the launch items above.
