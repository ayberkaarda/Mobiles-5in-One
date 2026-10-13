# ADR-0055: Transport policy, PWA Content-Security-Policy and dynamic scans

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 6, package 6C (spec items 10 and 23, item 9 for the PWA, finding 2 of the 6B attack report)
- Amends: ADR-0012 (API `Cross-Origin-Resource-Policy` is now `same-origin`)

## Context

Item 10 asks for automatic TLS with redirect, HSTS preload, no cleartext on Android or iOS and an
API that refuses `http` behind the proxy; Done is "`http://` request redirects; native config
tests". Item 23 asks for ZAP baseline scans of web and PWA, an API scan from `openapi.json`, MobSF
on the APK and IPA and a pentest report with fixes and retest. Item 9 lists the header set; the
6B sweep found that the PWA sent no Content-Security-Policy at all (finding 2 of
`docs/security/attack-report.md`).

Before this package the API sent HSTS on every answer but served plain http; the local Caddyfile
had plain http sites only and proxied the PWA dev server; the Android manifest had
`usesCleartextTraffic="false"` but `allowBackup="true"` and no network security config. There is
no hosted target and no macOS host.

## Decision

1. **The API refuses plain http with 403, it does not redirect.** `app/core/https.py`
   (`HttpsOnlyMiddleware`, after the security headers, before CORS) treats a request as https when
   it arrived over TLS or when its direct peer is inside `INECEKVAR_TRUSTED_PROXY_CIDRS` and sends
   exactly one `X-Forwarded-Proto` with `https` (the header name is `INECEKVAR_FORWARDED_PROTO_HEADER`).
   Any other request gets RFC 9457 403 `transport.https_required` with the usual security headers
   and no `Location`. A 308 would silently carry on a client that already sent a token or cookie
   in cleartext; refusing makes a misrouted client fail loudly, while browsers are redirected at
   the edge (decision 3) and pinned by HSTS. The forwarded value from any other peer is ignored, as
   the client IP header is (ADR-0009). `INECEKVAR_REQUIRE_HTTPS` unset means enforced in
   `production` and off in `local` and `test` (dev servers and the test client speak http);
   `production` refuses `false`. `GET /v1/health` stays reachable for platform probes (no data).
   uvicorn must run with `--no-proxy-headers` so only these settings decide what is trusted. The
   application cannot enforce a server flag; since the phase 6 review every documented start
   command carries `--no-proxy-headers --forwarded-allow-ips 127.0.0.1` (README, CONTRIBUTING,
   `docs/ops/env.md`, the compose header, the release checklist deploy row, the web e2e real
   stack; no Dockerfile or entry point exists yet, release checklist G1). Before that the
   commands omitted it, and uvicorn's default (`--proxy-headers` for peers in
   `--forwarded-allow-ips`, default 127.0.0.1) rewrote the client address and the scheme from
   `X-Forwarded-For` and `X-Forwarded-Proto` before this middleware ran; executed on the
   workstation with `INECEKVAR_REQUIRE_HTTPS=true` and a trusted-proxy list without 127.0.0.1, a
   spoofed `X-Forwarded-Proto: https` sent straight to uvicorn answered 404 (passed the https
   check) with the default flags and 403 with `--no-proxy-headers`. The release checklist
   section 9 repeats that smoke check after deploy.
2. **HSTS stays on every API answer.** Browsers ignore it over http (RFC 6797), so sending it
   always is harmless and keeps the header test simple; on https answers it is asserted.
3. **Caddy serves https only and redirects http with 308.** `ops/Caddyfile`: `local_certs`
   (Caddy's own CA, never a public one locally), sites for web (8443), PWA (8444) and API (8445,
   the `api.inecekvar.app` stand-in), each `http://` listener answering only
   `redir https://{host}:<host port>{uri} 308` (308 keeps the method); no `trusted_proxies`, so a
   client's `X-Forwarded-*` is overwritten; the `Server` header is removed; HSTS and nosniff on
   every site. The PWA site serves the production build from `dist/apps/mobile/browser` as
   production will (the dev server stays on 8100), with `no-cache` on everything that is not a
   hashed bundle and `immutable` on hashed bundles.
4. **PWA Content-Security-Policy in the `(pwa_headers)` snippet.** `default-src 'self'`;
   `script-src 'self'` plus the SHA-256 of the one inline script of the production build (the
   stylesheet loader the critical-CSS step writes); `script-src-attr 'none'`; `style-src 'self'
   'unsafe-inline'`; `img-src 'self' data: blob:` and the tiles origin; `connect-src 'self'`, the
   API origin, the tiles origin and the presigned upload origin (`INECEKVAR_PWA_UPLOAD_ORIGIN`,
   default `https://*.r2.cloudflarestorage.com`, to be narrowed to the account endpoint at
   deployment, locally the MinIO origin); `worker-src 'self' blob:`; `manifest-src`, `form-action`
   and `base-uri 'self'`; `object-src 'none'`; `frame-ancestors 'none'`. Plus HSTS,
   `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
   `Permissions-Policy: geolocation=(self), camera=(), microphone=()`, COOP and CORP
   `same-origin`. No `upgrade-insecure-requests`: every listed source is already https or
   same-origin, and the directive would rewrite the local MinIO upload.
5. **Styles keep `'unsafe-inline'`, scripts never do.** Angular inserts component styles and
   Ionic inserts its own at run time, and the build inlines critical CSS; a nonce would need a
   per-response server for a static PWA and Ionic does not take Angular's nonce. Style injection
   needs an HTML injection first, which text-only binding (item 16) and the strict script policy
   leave without a script. Disabling inline critical CSS to drop the hash was rejected: it costs
   first paint and the hash is checked anyway (decision 6).
6. **The hash is checked from the build, not trusted by hand.** `apps/mobile/scripts/csp-hash-check.mjs`
   (target `mobile:csp-check`, which builds first and which `mobile-e2e:e2e` depends on) hashes
   every inline script of `dist/apps/mobile/browser/index.html`, requires the snippet's
   `script-src` hashes to equal that set, refuses `'unsafe-inline'`, `'unsafe-eval'`,
   `'unsafe-hashes'`, wildcards and scheme sources for scripts and inline event handlers, and pins
   `object-src`, `base-uri`, `frame-ancestors`, `script-src-attr` and `worker-src`.
   `apps/mobile/scripts/pwa-headers.mjs` is the one parser of the snippet: the check, the e2e
   static server `apps/mobile-e2e/serve.mjs` and `csp.spec.ts` all read the Caddyfile, so every
   PWA e2e scenario runs under the production policy.
7. **Android: no cleartext, no backup.** `res/xml/network_security_config.xml` (base config
   `cleartextTrafficPermitted="false"`, system trust anchors only) referenced from the manifest
   next to `usesCleartextTraffic="false"`; `allowBackup="false"` with `fullBackupContent` and
   `dataExtractionRules` excluding every domain (refresh token, ride drafts with GPS points,
   packs). No debug exception: the debug build has no need for cleartext either. Certificate
   pinning is not adopted (rotating public certificates; a wrong pin locks out every install).
   `apps/mobile/scripts/android-transport-check.mjs` runs before `mobile:lint` on the sources and,
   with `--apk` (and `--release`), on a built APK through aapt2.
8. **API `Cross-Origin-Resource-Policy: same-origin`** (was `same-site`, ADR-0012), from ZAP
   rule 90004: every caller reads the API with fetch in CORS mode, where CORP does not apply, or
   through the same-origin proxy; no page embeds API answers.
9. **NUL in a URL is a validation failure.** ZAP's active scan sent `%00` in `city=` and PostgreSQL
   refused it (SQLSTATE 22021), answered as a generic 500. `app/core/url_guard.py` refuses a NUL in
   the path or query with 422 `validation.failed` before routing (bodies were already covered by
   the text rules).
10. **Scans are scripts with pinned images and triaged rule files.** `ops/security/zap/`
    (`run-zap.sh`, `baseline.conf`, `api-scan.conf`, `api-context.xml`; ZAP 2.17.0 by digest) runs
    both baselines and the authenticated API scan through the Caddy https sites; every FAIL and
    INFO line states its reason. `ops/security/mobsf/run-mobsf.sh` (MobSF v4.5.4 by digest,
    random API key, 127.0.0.1 only). Raw reports stay out of git
    (`docs/security/scan-reports/.gitignore`); the trimmed numbers are in `zap-scans.md` and
    `mobsf-static.md`.

## Evidence

- Gates: `uv run ruff check .` → `All checks passed!`, `uv run mypy --strict app tests` →
  `Success: no issues found in 232 source files`, `uv run pytest -q` → `1141 passed in 630.26s`;
  `pnpm nx run-many -t lint test build -p mobile web --skip-nx-cache` → web `785 passed`, mobile
  `472 passed`, `Successfully ran targets lint, test, build for 2 projects and 1 task they depend
  on`; `IV_E2E_STACK=iv6b IV_E2E_REAL_API=1 pnpm nx run web-e2e:e2e` → `63 passed`;
  `pnpm nx run mobile-e2e:e2e` on a fresh `iv6b` stack → `PWA CSP check passed`, `10 passed`.
- `tests/core/test_https.py` (18:
  environment rule, 12 scheme cases, plain http refused with problem body and headers, spoofed
  `X-Forwarded-Proto`/`Forwarded`/`X-Forwarded-Ssl` from an outside peer refused, trusted proxy
  marked https served with HSTS, duplicated header refused, TLS at the process served, health
  exempt, local and test exempt); `tests/core/test_headers.py::test_api_isolation_headers_are_pinned`;
  `tests/security/test_attack_suite.py::test_nul_in_path_or_query_is_refused_not_a_server_error`.
- Real stack (compose project `iv6b`, Caddy 2.11.7, API with `INECEKVAR_REQUIRE_HTTPS=true`):
  `curl -I http://127.0.0.1:57081/hat/x?city=y` → `308 Permanent Redirect`,
  `Location: https://127.0.0.1:58444/hat/x?city=y`; `POST http://localhost:57080/api/v1/auth/login`
  → `308 https://localhost:58443/api/v1/auth/login`; `https://localhost:58444/api/v1/cities` → 200
  with HSTS; the API directly over http → `403` `transport.https_required`.
- PWA CSP: `node apps/mobile/scripts/csp-hash-check.mjs` → `PWA CSP check passed: 1 inline script
  hash(es) match ops/Caddyfile`; `apps/mobile-e2e/src/csp.spec.ts` passed against `serve.mjs` and
  against the Caddy site (`IV_E2E_BASE_URL=https://localhost:58444`, `1 passed`): header equal to
  the snippet, the loader ran, service worker in control, Ionic styles applied, lazy map chunk and
  `maplibre-gl-worker.mjs` loaded, reload from the service worker keeps the header, zero
  `securitypolicyviolation` events and zero CSP console messages in page and workers. A probe page
  under the same header reported `connect-src https://evil.example/x` and `script-src-elem inline`,
  so the listener sees violations. Full `mobile-e2e:e2e` under the policy: 10 passed.
- ZAP run 3: web and PWA baselines `FAIL-NEW: 0 WARN-NEW: 0 INFO: 5 PASS: 62`, API scan
  `FAIL-NEW: 0 WARN-NEW: 0 INFO: 0 PASS: 118` (251 URLs, 0 server errors);
  `docs/security/scan-reports/zap-scans.md`.
- MobSF: debug APK score 49 before and 53 after, release APK 56; `allowBackup` warning gone,
  "disallow clear text traffic to all domains" reported secure; aapt2 read-back of both APKs
  `usesCleartextTraffic=false allowBackup=false`, release `debuggable=absent`;
  `docs/security/scan-reports/mobsf-static.md`.
- Mutations, each red then restored: forwarded proto trusted from any peer (`test_https.py`: 4
  failed, `assert 200 == 403` on the spoof test); CSP hash not matching the inline script
  (`csp-hash-check.mjs` exit 1 naming both hashes, `csp.spec.ts` failed on the missing hash);
  cleartext permitted in the release manifest (`usesCleartextTraffic="true"`, base config
  `cleartextTrafficPermitted="true"`, `allowBackup="true"`: `android-transport-check.mjs` exit 1
  each); URL guard removed (`assert 500 == 422`).

## Not exercised

- A public certificate, the HSTS preload submission and a hosted proxy or CDN in front of the
  sites (no host); the production `api.inecekvar.app` site with real DNS.
- iOS: no macOS host, so no IPA, no MobSF iOS scan and no App Transport Security check beyond the
  absence of exceptions in the repository.
- The ZAP and MobSF jobs in CI (no workflow change in this package); a dynamic mobile assessment
  on a device.
- Trusted Types (`require-trusted-types-for 'script'`) for the PWA: not evaluated against Ionic.

## Consequences

- A deployment must set `INECEKVAR_TRUSTED_PROXY_CIDRS` to the proxy address only: any process
  inside those networks can mark a request https, as it can set the client IP.
- A change of the beasties loader (Angular update) changes the hash: `mobile:csp-check` and the
  e2e fail until the snippet is updated with `node apps/mobile/scripts/csp-hash-check.mjs --print`.
- The compose PWA site needs a production build; `pnpm nx serve mobile` remains the dev path.
