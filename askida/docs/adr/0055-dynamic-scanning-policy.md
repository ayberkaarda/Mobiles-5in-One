# ADR-0055: Dynamic scanning policy (OWASP ZAP)

- Status: Accepted
- Date: 2026-10-05
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

Security checklist item 23 names an OWASP ZAP baseline scan of the web and an API scan from
`docs/api/openapi.yaml`. There is no deployed host and no TLS endpoint; the scans run against the
local compose stack over plain HTTP. A scan that only reports, with nothing pinned, cannot catch
a regression.

## Decision

- Image `ghcr.io/zaproxy/zaproxy:stable` pinned by digest (ZAP 2.17.0,
  `sha256:781a2bdaea47324e7bab583e2263f21d257b0aee61ed51521a5be45f5f5081ef`), the same digest in
  `.github/workflows/askida-security.yml`.
- Baseline: `zap-baseline.py` with a 5-minute spider over the public web. API: `zap-api-scan.py`
  importing `openapi.yaml`, active scan capped at 60 minutes, `Authorization` set for a seeded
  donor token minted at run time and passed only through the environment. The context covers the
  whole host (the active scan starts at the root; otherwise every request is out of context) and
  excludes `/api/v1/auth/logout`.
- Rule files `server/.zap/baseline.conf` and `server/.zap/api-scan.conf`: `FAIL` = a fixed or
  never-present alert that must stay absent (regression guard), `INFO` = an accepted alert with
  its reason, everything else `WARN`. `-I` keeps warnings from failing the run.
- HTML and JSON reports are not committed (`server/.zap/reports/` is ignored); the summary lives in
  `docs/security/zap-report.md`.
- Local relaxations of the scan stack, all documented in `zap-report.md` section 1:
  - **`APP_ENV=local`. Deviation from the Phase 6 plan**, which allowed only
    `SESSION_SECURE_COOKIE=false`: outside `local`/`testing` the boot refuses the fake payment,
    attestation and push drivers and `EnforceHttps` redirects every plain-HTTP request, so a
    production-like environment would only show 301 answers. `APP_DEBUG=false` as in production.
  - `SESSION_SECURE_COOKIE=false`, no HSTS (plain HTTP), local `APP_URL`, fake drivers,
    `BREACHED_PASSWORD_CHECK=false` (no call to the external range API).
  - Scan-only tuning through an untracked compose override: `opcache.validate_timestamps=0` and the
    branch's nginx configuration mounted read-only. Not part of the image.
- Accepted alerts: CSP `unsafe-inline`/`unsafe-eval` on `/admin` (Filament, see ADR-0054); COEP
  absent (`require-corp` would block the provider checkout frame); `XSRF-TOKEN` without HttpOnly
  (readable by design, not a session credential); "HTTP only site" on the API (local relaxation;
  production answers HTTP API calls with 403 `https_required`).
- Fixed from the scans: nginx answered directory paths itself without security headers
  (`try_files $uri $uri/` reduced to `$uri`), `Cross-Origin-Resource-Policy: same-origin` on static
  files and in the application (was `same-site`), and the nginx access log format `askida_private`
  (time, method, path without query, protocol, status, bytes, duration; `/pay/<token>` logged as
  `/pay/-`; no client address, query, referrer or browser header).
- CI: job `zap` on the weekly schedule and manual runs, informational, outside the security gate.

## Consequences

- Recorded locally: baseline run 2 `FAIL-NEW 0, WARN-NEW 3, INFO 3, PASS 61`; API run 1 (complete,
  13 minutes) `FAIL-NEW 0, WARN-NEW 1, PASS 118`, 0 responses 5xx; 0 High overall.
- API run 2 took 61 minutes and reached the 60-minute active-scan cap, so it **may have been cut
  short**; run 1 is the complete pass. The `INFO` line for rule 10106 and the wider 100001 message
  were added after run 2 and have not been through a third run.
- About a third of the API requests were answered 429 or 404 (limiters, example ids absent from the
  seed), so the active rules reached a subset of handlers; those paths are covered by the attack
  suite (ADR-0053).
- Residual: nginx error-log lines (failures only) still quote the client address and request line;
  error pages that nginx writes itself (400, 413) carry no security headers. Both are open questions.
- not exercised: HTTPS behaviour (HSTS, `__Host-` cookie, redirect) through ZAP, a production-like
  `APP_ENV`, an authenticated scan of the panel, merchant and anonymous tokens in the API scan, the
  GitHub `zap` job (runs only after the push).
