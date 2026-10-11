# ADR-0001: Stack and resolved versions

- Status: Accepted
- Date: 2026-10-12
- Deciders: Ayberk (owner)

## Context

The specification (`05-inecekvar-ionic-angular.md`, sections 0.8 and 4) fixes the stack: an Nx
workspace with an Ionic Angular app on Capacitor (PWA first), an Angular SSR web app and shared
libraries, plus a separate FastAPI project on PostgreSQL with PostGIS and Redis. It asks for the
latest stable Angular, Ionic, Capacitor and Nx, Python 3.12 or newer and FastAPI at scaffold time,
pinned by `pnpm-lock.yaml` and `uv.lock`, with the resolved versions recorded here.

The values below were read from the lockfiles and from local runs on 2026-10-12 on the owner's
Windows 11 machine (Node 22.23.2, pnpm 12.8.1, uv 0.12.5, Docker 29.7.2 with Compose 5.5.1,
Temurin JDK 21.0.12, Android SDK platforms 35 to 37). The evidence rule of ADR-0005 applies: a
step that did not run here is listed as `not exercised` with the reason, never as passed.

## Decision

Use the latest stable releases, pinned exactly in `package.json` (no ranges) and through
`uv.lock`, as listed below. Choices that deviate from a default or that need explanation:

1. **Ionic 9, not Ionic 8.** Section 4 says "Ionic 8", section 0.8 says "latest stable at scaffold
   time". Ionic 9.0.7 is the latest stable release and supports Angular 22 standalone and zoneless
   apps, so section 0.8 wins. The README still says Ionic 8 and should be aligned.
2. **Angular 22.2.2 above the Nx default.** The Nx 23.3.0 scaffolding installs Angular 22.1; the
   workspace was raised to 22.2.2, which the `@nx/angular` peer range (`>= 20 < 23`) allows. An
   Angular 23 upgrade waits for an Nx release that accepts it.
3. **TypeScript 6.0.3, not 7.** The Angular 22 compiler requires `typescript >=6.0 <6.1`.
4. **Test runners.** Both apps use the Angular unit-test builder (`@angular/build:unit-test`) on
   Vitest 5 with jsdom. The libraries use Vitest through `@analogjs/vitest-angular`, because the
   Angular builder needs buildable libraries and these are source-only path aliases. Nx prints a
   notice that the `@nx/eslint:lint` and `@nx/vitest:test` executors are removed in Nx 24; the
   targets move to inferred targets (`nx g @nx/eslint:convert-to-inferred`,
   `nx g @nx/vitest:convert-to-inferred`) before that upgrade.
5. **Lint stack.** ESLint 9.39.5 (the Nx flat config default; ESLint 10 exists and is a separate
   upgrade), angular-eslint 22.5.0. angular-eslint 22.6.0 was published on 2026-10-11 and is
   inside pnpm's minimum release age, so the workspace keeps 22.5.0 instead of adding release-age
   exceptions; Renovate proposes 22.6.0 once it is old enough.
6. **Zoneless change detection** in both apps (the Angular 22 default); Ionic runs on it.
7. **Install scripts.** `pnpm-workspace.yaml` allows only the `nx` install script. The esbuild,
   lmdb, msgpackr-extract and `@parcel/watcher` scripts are denied; their native binaries arrive
   as optional platform packages and every gate below passed without the scripts.
8. **API project.** Python 3.12.14 through `.python-version` and `requires-python >=3.12,<3.13`; a
   uv application without a build backend (`tool.uv.package = false`). Phase 0 installs only what
   the health endpoint and the connectivity test use (FastAPI, Pydantic, uvicorn, asyncpg);
   SQLAlchemy, GeoAlchemy2, Alembic, pydantic-settings and the rest of section 4 arrive with the
   Phase 1 code that uses them. uvloop is not installed on Windows (uvicorn's `standard` extra
   excludes it there); Linux and CI get it.
9. **PostGIS test paths.** `tests/test_postgis.py` uses `INECEKVAR_TEST_DATABASE_URL` when it is
   set (the CI service container) and otherwise starts `postgis/postgis:16-3.5` with
   Testcontainers. Without Docker the test is skipped with the reason; CI sets
   `INECEKVAR_REQUIRE_DOCKER=1`, which turns that skip into a failure, and rejects any skipped case
   in the JUnit report as `askida-ci.yml` does.
10. **Capacitor Android.** `apps/mobile/android` is committed (application id
    `app.inecekvar.mobile`, `androidScheme: 'https'`). `capacitor.settings.gradle` carries the pnpm
    store path of `@capacitor/android` and is rewritten by every `cap sync`. Gradle needs JDK 21
    (the machine default is JDK 26), set in the same shell command as the build. The Capacitor
    template example tests were removed; launcher icons and splash images stay the Capacitor
    defaults until the brand icon set replaces them.
11. **Native builds on manual dispatch only** (section 8). The `android` job of
    `inecekvar-ci.yml` runs on `workflow_dispatch` and is not part of `Inecek Var CI gate`. iOS is
    not scaffolded in Phase 0 (no macOS host); it is added in Phase 3.
12. **SSR host allowlist.** The web build sets `security.allowedHosts` to `inecekvar.app`; Angular
    SSR answers 400 to any other `Host`. Local production-build runs add hosts with
    `NG_ALLOWED_HOSTS` (for example `NG_ALLOWED_HOSTS=127.0.0.1`).
13. **Design tokens.** `brand/tokens.json` holds the section 2 palette and typography;
    `brand/scripts/build-tokens.mjs` writes `libs/ui/src/styles/tokens.css` (brand variables and
    the Ionic colour variables with rgb, contrast, shade and tint) and `--check` fails CI when the
    stylesheet is stale. DM Sans and Inter are named in the tokens; the self-hosted font files
    arrive with the brand asset package.
14. **MinIO images.** Local compose uses the `pgsty/minio` and `pgsty/mc` community images, the
    same as Askida (ADR-0001 there: the official images could not be pulled). Production object
    storage is Cloudflare R2.

### Resolved versions

| Area                  | Package or tool                                                       | Version                        |
| --------------------- | --------------------------------------------------------------------- | ------------------------------ |
| Workspace             | nx, @nx/angular, @nx/js, @nx/eslint, @nx/vitest, @nx/vite, @nx/web    | 23.3.0                         |
| Workspace             | pnpm (`packageManager`), Node (`.nvmrc`)                              | 12.8.1, 22                     |
| Angular               | @angular/core, common, router, forms, platform-browser, platform-server, service-worker, ssr, build, cli, compiler-cli | 22.2.2 |
| Angular               | typescript, rxjs, tslib                                               | 6.0.3, 7.8.2, 2.8.1            |
| Mobile                | @ionic/angular, ionicons                                              | 9.0.7, 8.1.0                   |
| Mobile                | @capacitor/core, @capacitor/cli, @capacitor/android                   | 8.5.3                          |
| Mobile                | @capacitor/app                                                        | 8.1.2                          |
| Web                   | express, @types/express                                               | 5.3.0, 5.0.6                   |
| Tests                 | vitest, @vitest/coverage-v8, @vitest/ui, vite, jsdom                  | 5.0.3, 5.0.3, 5.0.3, 8.3.4, 27.4.0 |
| Tests                 | @analogjs/vitest-angular, @analogjs/vite-plugin-angular               | 2.8.0                          |
| Lint and format       | eslint, angular-eslint, typescript-eslint, prettier                   | 9.39.5, 22.5.0, 8.71.1, 3.9.10 |
| Android               | Android Gradle plugin, Gradle wrapper                                 | 8.13.0, 8.14.3                 |
| Android               | compileSdk / targetSdk / minSdk                                       | 36 / 36 / 24                   |
| API                   | Python (uv managed CPython)                                           | 3.12.14                        |
| API                   | fastapi, starlette, pydantic, pydantic-core                           | 0.143.0, 1.7.0, 2.14.1, 2.50.1 |
| API                   | uvicorn, asyncpg                                                      | 0.54.0, 0.32.0                 |
| API (dev)             | ruff, mypy, pytest, httpx, anyio                                      | 0.17.0, 2.4.0, 9.1.1, 0.28.1, 4.15.1 |
| API (dev)             | testcontainers, asyncpg-stubs, types-docker                           | 4.15.0, 0.32.0, 7.2.0.20261006 |
| Data services         | postgis/postgis:16-3.5 (PostgreSQL / PostGIS)                         | 16.9 / 3.5.2                   |
| Data services         | redis:7.4.11-alpine                                                   | 7.4.11                         |
| Local services        | caddy:2.11.7-alpine, axllent/mailpit                                  | 2.11.7, v1.31.4                |
| Local services        | pgsty/minio, pgsty/mc                                                 | RELEASE.2026-08-04, RELEASE.2026-09-16 |
| CI                    | gitleaks (SHA-256 checked)                                            | 8.30.1                         |
| CI                    | astral-sh/setup-uv (pinned by commit SHA), uv                         | v10.2.0, 0.12.5                |

### Local ports

Everything binds to 127.0.0.1. Compose defaults (overridable, see `docker-compose.yml`):
PostgreSQL 57432, Redis 57379, Caddy web site 57080 and app site 57081, MinIO 57900 (console
57901), Mailpit SMTP 57025 and UI 57825. Host processes: API 57800
(`uv run uvicorn app.main:app --port 57800`), web dev server 4200, mobile dev server 8100. Caddy
proxies `/api/*` on both sites to the API so the browser origins stay same-origin.

### Phase 0 evidence

Logs of every command are kept outside the repository by the Phase 0 run; the results are
summarised here.

| # | Step | Command | Result |
| - | ---- | ------- | ------ |
| 1 | Toolchain | `node --version`, `pnpm --version`, `uv --version`, `docker version`, `java -version` | Node 22.23.2, pnpm 12.8.1, uv 0.12.5, Docker 29.7.2 / Compose 5.5.1; default java is 26.0.2.1, JDK 21.0.12 present |
| 2 | Nx scaffold | `nx g @nx/angular:application` (mobile, web with `--ssr`), `nx g @nx/angular:library` (ui, domain, data-access) | exit 0; the libraries needed `--unitTestRunner=vitest-analog` (the Angular runner refused non-buildable libraries) |
| 3 | Install | `pnpm install --frozen-lockfile` | exit 0, lockfile passes pnpm supply-chain policies |
| 4 | Tokens | `node brand/scripts/build-tokens.mjs --check` | exit 0; it also failed as intended when the stylesheet had been reformatted |
| 5 | Format | `pnpm exec prettier --check .` | exit 0 |
| 6 | Workspace gate | `pnpm nx run-many -t lint test build --skip-nx-cache` | exit 0: 5 lint, 5 test (12 tests: domain 4, ui 3, data-access 3, mobile 1, web 1), 2 production builds; web prerendered 1 route; mobile initial bundle 440 kB raw, 115 kB transfer |
| 7 | SSR smoke | `node dist/apps/web/server/server.mjs` with `NG_ALLOWED_HOSTS=127.0.0.1` | `/` 200 with the tagline and no `X-Powered-By`; unknown path 404; `Host: evil.example` 400 |
| 8 | uv project | `uv init`, `uv add`, `uv sync --locked` | exit 0, CPython 3.12.14 |
| 9 | API gate | `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy --strict app tests` | all exit 0 (8 files) |
| 10 | API tests | `uv run pytest` | 3 passed; the PostGIS test ran on Testcontainers `postgis/postgis:16-3.5` through Docker Desktop |
| 11 | Skip path | `DOCKER_HOST=tcp://127.0.0.1:9 uv run pytest -m postgis` | 1 skipped with "Docker is not reachable (DockerException ...)" |
| 12 | Fail path | same with `INECEKVAR_REQUIRE_DOCKER=1` | error at setup, exit 1, as intended |
| 13 | API smoke | `uv run uvicorn app.main:app --port 57800`, `curl /v1/health` | `{"status":"ok"}` 200; `/health` 404 |
| 14 | Compose config | `docker compose -p inecekvar-p0 config --quiet` | exit 0 |
| 15 | Compose up | `docker compose -p inecekvar-p0 up -d --wait` | postgres, redis, minio, mailpit, caddy healthy; minio-init exited 0 (buckets created). `--wait` itself returned exit 1 because it counts the finished one-shot init container; the stack was removed with `down -v` afterwards |
| 16 | Proxy and service DB | `curl 127.0.0.1:57080/api/v1/health` and `:57081`; pytest with `INECEKVAR_TEST_DATABASE_URL` on the compose database | both 200 `{"status":"ok"}`; 1 passed (the CI service-container path) |
| 17 | Capacitor | `cap add android`, then `pnpm nx run mobile:cap-sync` | exit 0; `@capacitor/app` 8.1.2 detected |
| 18 | Android build | `JAVA_HOME=<jdk-21> ./gradlew assembleDebug --no-daemon --rerun-tasks` in one shell command | BUILD SUCCESSFUL, `app-debug.apk` 4.3 MB |
| 19 | Workflow lint | `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/inecekvar-ci.yml` | exit 0 (shellcheck not installed, so the embedded scripts were not shell-linted) |
| 20 | Renovate | `renovate-config-validator renovate.json` (renovate 41) | the new Inecek Var rules validate; the file as a whole reports two errors that already exist on main (Askida composer and pub rules combine `matchUpdateTypes` with `rangeStrategy`) |
| 21 | Hooks | `lefthook validate` (lefthook 2.1.15) | "All good" |
| 22 | Secrets | `gitleaks git --pre-commit --staged` before each commit, `gitleaks git` over the branch | no leaks found |

Not exercised:

- `not exercised: iOS` (no macOS host; Capacitor iOS arrives in Phase 3).
- `not exercised: inecekvar-ci.yml on GitHub Actions` (the branch is not pushed; only actionlint
  ran locally).
- `not exercised: the lefthook hooks themselves` (hooks are not installed in this repository;
  only `lefthook validate` ran).
- `not exercised: the APK on an emulator or device` (build only; the Capacitor smoke is Phase 3).
- `not exercised: dev servers behind Caddy` (`nx serve web|mobile` were not started; Caddy
  answered 502 for `/`, as expected without them).

## Consequences

- Upgrades arrive through Renovate in the groups added to the root `renovate.json`: Angular with
  Nx, Ionic with Capacitor, Python minor and patch (only `uv.lock` moves), Android Gradle and the
  compose images.
- An Angular 23 or Nx 24 upgrade is a deliberate step: Nx's peer range bounds Angular, and Nx 24
  drops the two executors named in decision 4.
- Gradle commands on this machine must set `JAVA_HOME` to JDK 21 in the same shell command.
- The README's "Ionic 8" line and any later document that names versions should follow this ADR.
