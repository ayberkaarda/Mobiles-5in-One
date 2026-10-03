# Running and testing the web app

How to run `apps/web` locally and which suites guard it. Commands are taken from
`package.json`, `apps/web/package.json`, `turbo.json`, `.github/workflows/kadro-ci.yml` and the
header comments of the test files. The "Run for this page" column says whether the command was
executed while this page was written; "not run" means it was documented from the sources only.

All commands run from `kadro/` unless a directory is given. Requirements: Node.js from `.nvmrc`
(at least 22.12.0), pnpm as pinned in `packageManager`, Docker (database and database-backed
tests), and a local Chrome or Edge for the browser suites.

## Environment variables

Configuration is validated by `packages/config/src` (`schema.ts`); that package is the only reader
of `process.env`. The app fails fast at boot when a required value is missing or invalid. An empty
value counts as unset. [`.env.example`](../../.env.example) documents every key with a dummy
value; copy it to `.env` at the repository root. `pnpm dev` and `pnpm start` load it
(`--env-file-if-exists=../../.env`).

Needed for the web app:

| Variable                                                                  | Purpose                                                                                                                                                                     |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`, `APP_ENV`, `BUILD_SHA`, `LOG_LEVEL`                           | runtime mode (`development`/`test`/`production`, `local`/`preview`/`production`), build id, log level                                                                       |
| `DATABASE_URL`                                                            | PostgreSQL 16 with PostGIS                                                                                                                                                  |
| `WEB_ORIGIN`                                                              | canonical origin; used by canonical URLs, sitemap, robots, JSON-LD. Outside local it must be a non-loopback `https://` origin                                               |
| `CORS_ALLOWED_ORIGINS`                                                    | exact browser origins for the API; must include `WEB_ORIGIN`                                                                                                                |
| `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`, `CSRF_SECRET`, `HASH_SECRET`         | left empty in `.env.example` on purpose; print local values with `pnpm --silent --filter @kadro/config secrets:generate`. The web app refuses to start while they are empty |
| `SESSION_COOKIE_NAME`, `CSRF_COOKIE_NAME`                                 | must use the `__Host-` prefix and differ                                                                                                                                    |
| `CLIENT_IP_HEADER`, `TRUSTED_PROXY_CIDRS`                                 | client address resolution for rate limits                                                                                                                                   |
| `TOTP_ENCRYPTION_KEY`                                                     | AES-256-GCM key for staff TOTP secrets. Optional locally, but without it the admin panel's enrollment and step-up answer 503                                                |
| `APPLE_TEAM_ID`, `APPLE_APP_STORE_ID`, `ANDROID_CERT_SHA256_FINGERPRINTS` | optional; each enables an app-link file or the Smart App Banner. Unset means 404 for the file                                                                               |
| `EMAIL_TRANSPORT`, `RESEND_API_KEY`, `EMAIL_FROM`                         | account e-mails (`log` transport locally)                                                                                                                                   |
| `MEDIA_PUBLIC_BASE_URL`, `R2_*`                                           | uploads and media                                                                                                                                                           |
| `REVENUECAT_WEBHOOK_SECRET`                                               | webhook authentication (the webhook answers 503 without it locally)                                                                                                         |

Test and tooling switches (not application configuration):

| Variable                       | Used by                                                                                      |
| ------------------------------ | -------------------------------------------------------------------------------------------- |
| `CI`                           | `true` turns a missing prerequisite (build output, browser) into a failure instead of a skip |
| `KADRO_TEST_BROWSER`           | path of the Chrome or Edge binary for the browser suites                                     |
| `KADRO_LIGHTHOUSE`             | `1` enables the Lighthouse suite (`pnpm lighthouse` sets it)                                 |
| `CHROME_PATH`                  | Chrome binary for Lighthouse CI                                                              |
| `LHCI_CHROME_FLAGS`            | extra Chrome flags for Lighthouse CI (the CI job adds `--no-sandbox`)                        |
| `LHCI_URLS`, `LHCI_OUTPUT_DIR` | set by the Lighthouse suite itself                                                           |

## Run locally

| Step                                           | Command                                                                            | Run for this page |
| ---------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------- |
| Install                                        | `pnpm install`                                                                     | not run           |
| Create `.env`, then paste the printed secrets  | `cp .env.example .env` and `pnpm --silent --filter @kadro/config secrets:generate` | not run           |
| Start PostgreSQL + PostGIS                     | `pnpm db:up`                                                                       | not run           |
| Build workspace packages (and the app)         | `pnpm build`                                                                       | not run           |
| Apply migrations                               | `pnpm --filter @kadro/db db:migrate`                                               | not run           |
| Seed districts and `[ÖRNEK]` sample venues     | `pnpm --filter @kadro/db db:seed`                                                  | not run           |
| Web and worker in development mode             | `pnpm dev` (web on `http://localhost:3000`)                                        | not run           |
| Worker only (processes e-mails, venue imports) | `pnpm worker:dev`                                                                  | not run           |
| Production server of the built app             | in `apps/web`: `pnpm start`                                                        | not run           |
| Whole stack in containers                      | `docker compose up --build`                                                        | not run           |

A fresh seed has sample venues only (`is_sample = true`), so `/saha/<slug>` shows the sample
notice and `noindex`, and the sitemap lists no venue until a verified, non-sample venue exists
(real venues come through the admin import, see [admin-panel.md](admin-panel.md)).

## Static gates

| Command                                    | What it checks                                                                                  | Run for this page                                                       |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm lint`                                | ESLint over every package; the web app also lints `scripts/security` with zero warnings allowed | not run                                                                 |
| `pnpm typecheck`                           | `next typegen` and `tsc --noEmit` per package                                                   | not run                                                                 |
| `pnpm build`                               | production build of every package                                                               | not run                                                                 |
| `pnpm format:check` (`pnpm format` writes) | Prettier                                                                                        | the files of this page only: run before the commit; whole repo: not run |

## Tests (Vitest)

`pnpm test` (turbo) runs every package's suites; `@kadro/web#test` depends on a finished build.
For the web app alone:

```sh
pnpm build
pnpm --filter @kadro/web test        # vitest run, files under apps/web/tests/**
```

`apps/web/vitest.config.ts` starts one disposable PostgreSQL 16 + PostGIS container for the run
(Docker CLI required); each database-backed file creates and drops its own database. Test timeout
30 s, hook timeout 120 s. `tests/e2e/**` is excluded from Vitest.

Suites by purpose (all in `apps/web/tests/`):

| Area                  | Files                                                                                                                                                                                                                                   | Needs                                                                                                                               |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Built-server tests    | `built-server.test.ts` (no prerendered route, nonce on every script, raw odd paths), `seo/built-programmatic-pages.test.ts`, `content/built-content-pages.test.ts`, `invites/built-invite-landing.test.ts`, `pages/built-pages.test.ts` | a finished `next build` (`apps/web/.next/BUILD_ID`) and Docker; skipped locally when the build is missing, an error under `CI=true` |
| Headers and surfaces  | `security-headers.test.ts`, `proxy-matcher.test.ts`, `pages/page-headers.test.ts`, `security/headers-check.test.ts`                                                                                                                     | none beyond the above                                                                                                               |
| Marketing and content | `marketing/*.test.*`, `content/content.test.tsx` (loads every `.mdx` file)                                                                                                                                                              | none                                                                                                                                |
| SEO                   | `seo/json-ld.test.ts`, `seo/programmatic-units.test.ts`, `seo/queries.test.ts`, `seo/revalidation.test.ts`                                                                                                                              | Docker (database)                                                                                                                   |
| Account pages         | `pages/*.test.*` including `source-guards.test.ts`                                                                                                                                                                                      | browser for `browser.test.ts`                                                                                                       |
| API and security      | `auth/`, `teams/`, `matches/`, `calls/`, `venues/`, `uploads/`, `admin/`, `attack/`, `security/`                                                                                                                                        | Docker (database)                                                                                                                   |
| Quality               | `quality/web-quality.test.ts` (fonts, JSON-LD, in-browser accessibility audit)                                                                                                                                                          | build, Docker, Chrome or Edge                                                                                                       |
| Lighthouse (opt-in)   | `quality/lighthouse.test.ts`                                                                                                                                                                                                            | see below                                                                                                                           |

Run for this page: not run (no suite was executed while writing the documentation). The figures
recorded in the ADRs and in [seo-and-geo.md](seo-and-geo.md) come from the Phase 4 runs of the
branches that introduced each suite, not from a run on the current `main`.

### Quality suites

- `pnpm --filter @kadro/web exec vitest run tests/quality/web-quality.test.ts` needs a build,
  Docker and a local Chrome or Edge (`KADRO_TEST_BROWSER` overrides the search). The accessibility
  result is "no violation of the audited rules" (an in-page subset with a negative control), not
  "axe clean" (ADR-0059). Run for this page: not run.
- `pnpm --filter @kadro/web lighthouse` (or `pnpm lighthouse` in `apps/web`): after `pnpm build`,
  seeds a disposable database, starts `next start`, and runs `npx @lhci/cli@0.15.1 autorun` for
  home, features, blog index, one venue and one district page, three runs each, asserting the
  median (`apps/web/lighthouserc.cjs`: categories at least 0.9, CLS at most 0.1, LCP at most 2.5 s
  as a warning). It downloads `@lhci/cli` through `npx`; nothing is added to the dependencies. Set
  `CHROME_PATH` when Chrome is not found. Run for this page: not run. Last recorded local numbers
  and the open LCP gap: [seo-and-geo.md](seo-and-geo.md).
- Response headers of a running server: `node scripts/security/headers-check.ts [base-url]`
  (default `http://localhost:3000`; Node.js 22.18 or newer). It requests the probe path of every
  surface from the surface table and exits 1 on a missing or weaker header. Run for this page:
  not run.

## End-to-end tests (Playwright)

`apps/web/tests/e2e/admin.spec.ts` against the production build in installed Chrome. Details,
what it covers and what it does not: [admin-panel.md](admin-panel.md).

```sh
pnpm build
pnpm --filter @kadro/web test:e2e
```

Needs Docker (it starts its own PostGIS container and removes it afterwards) and Google Chrome
(`channel: 'chrome'`, no browser download). One worker, serial specs, 60 s per test. Test output
goes to the system temp directory, not into the repository. Run for this page: not run.

## CI

`.github/workflows/kadro-ci.yml` runs lint, typecheck and build (`verify` job) and the test job
(`pnpm test --continue=dependencies-successful`, with the PostGIS image pulled first); both feed
the `Kadro CI gate` job. The `lighthouse` job is separate and informational (not in the gate's
`needs`).
