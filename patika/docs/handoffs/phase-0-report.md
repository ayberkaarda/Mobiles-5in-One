# Patika — Phase 0 Report
## Summary (5 lines max)
Foundation delivered: solution projects for Domain, Contracts, Infrastructure, Api, Web, Worker, and tests; MAUI Android shell; brand tokens; contributor and architecture/security docs; local container stack and CI workflow.
The MAUI Android build replaces the template's xcodebuild gate under ADR-0001.
Pull request: #134.
## Files created / modified (grouped by owner, full paths)
- lead: patika/CONTRIBUTING.md; patika/docs/adr/0001–0004; patika/docs/security/authorization-matrix-draft.md; patika/docs/security/threat-model-outline.md; patika/.env.example; patika/docker-compose.yml; patika/brand/tokens.json; patika/.github/workflows/patika-ci.yml
- api: patika/Patika.slnx; patika/src/Patika.Domain; patika/src/Patika.Contracts; patika/src/Patika.Infrastructure; patika/src/Patika.Api; patika/src/Patika.Worker; patika/tests
- web: patika/src/Patika.Web
- mobile: patika/android MAUI shell
## Decisions & ADRs added
ADR-0001 through ADR-0004 record the stack and versions, hosting, map clustering approach, and iOS third-party policy. The requested xcodebuild gate is replaced by the MAUI Android build per ADR-0001. MinIO uses the pgsty/minio image because upstream MinIO images were removed from Docker Hub.
## Security checklist status
| # | Item | Status (done / partial / not-started) | Evidence (test name, doc path) |
|---|---|---|---|
| 1 | Foundation projects and boundaries | done | Patika.slnx; Domain, Contracts, Infrastructure, Api, Web, Worker, tests |
| 2 | Authorization matrix draft | partial | patika/docs/security/authorization-matrix-draft.md |
| 3 | Threat model outline | partial | patika/docs/security/threat-model-outline.md |
| 4 | Containerized local services | done | docker-compose.yml; PostGIS, MinIO, Api, Web, Worker |
| 5 | CI foundation | done | .github/workflows/patika-ci.yml |
| 6 | Accessibility and manifest review findings | done | Independent review findings fixed: sample label contrast 3.18 to 5.20; links 4.36 to 5.27; urgent step numbers 4.38 to 5.93; font licences packaged; heading levels corrected; network permissions removed |
## SEO/GEO status (Phase 4+)
Not in scope for Phase 0.
## Tests executed (command + result counts)
- `dotnet build Patika.slnx` — succeeded, including net10.0-android; 0 warnings, 0 errors.
- `dotnet test` Domain — 5/5 passed; Api — 4/4 passed.
- `dotnet format` verify — exit 0.
- `docker compose up` — Postgres and MinIO healthy; bucket created; Api `/health` returned 200; Web `/` returned 200.
## Known gaps / risks
Release Android build, iOS build (not built on this host; ADR-0001), dark mode, Lighthouse, and actionlint were not exercised. Local host port 5432 may already be occupied. Debug APK includes INTERNET permission for the debugger.
## Open questions / proposals (scope, cost, legal)
No open proposals recorded.
## Proposed Conventional Commits (not executed)
- `feat(api): establish solution foundation`
- `feat(android): add MAUI shell`
- `chore(ci): add Patika CI workflow`
## Next phase preview (3 lines)
Phase 1: API core, authentication, and security baseline.
Implement the planned identity and authorization foundations.
Run the phase gates and report results.
STOPPED — waiting for "devam".
