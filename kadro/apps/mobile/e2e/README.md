# Mobile end-to-end flows (Maestro, Android)

The Maestro flows in `apps/mobile/.maestro` drive a debug build of the app on an Android emulator
against a local Kadro stack (web + API, worker, PostgreSQL). Decisions and limits: ADR-0076.

| Flow               | What it covers                                                           |
| ------------------ | ------------------------------------------------------------------------ |
| `sign-up`          | registration form, "check your email" state                              |
| `sign-in`          | sign-in, session kept across an app restart, sign-out                    |
| `create-team`      | team creation by an account that owns no team                            |
| `create-match`     | captain creates and publishes a match with a free-text venue             |
| `rsvp`             | RSVP changes on a seeded open match                                      |
| `join-invite-link` | `kadro://mac/<code>` opens the preview, the join needs the tap           |
| `open-call-apply`  | apply to another team's open call from the Eksik Var tab                 |
| `venue-search`     | venue search finds the seeded sample venue                               |
| `profile-edit`     | display name and position change                                         |
| `deep-links`       | invite link held across the sign-in, venue link, unknown link opens home |
| `delete-account`   | account deletion with both confirmations and the password                |

## Prerequisites

- Android Studio with an emulator image (API 34 or newer, `x86_64` / `arm64` matching the host).
  The flows are written for a Pixel 8 AVD named `Pixel_8`: `emulator -avd Pixel_8`.
- JDK 17 (`JAVA_HOME` pointing at it) for the Gradle build. Maestro itself runs on JDK 17 or newer.
- Maestro CLI 2.9.0 (`curl -fsSL "https://get.maestro.mobile.dev" | bash`, or the
  `maestro.zip` of the `cli-2.9.0` release; the CI workflow checks its SHA-256).
- Docker, Node.js and pnpm as for the rest of the repository.

## 1. Start the local stack

From `kadro/`:

```sh
cp .env.example .env
pnpm --silent --filter @kadro/config secrets:generate   # paste the printed lines over the empty keys
pnpm install
pnpm turbo run build --filter=@kadro/db... --filter=@kadro/config
docker compose up -d --wait postgres
docker compose up db-roles
pnpm --filter @kadro/db db:migrate
pnpm --filter @kadro/db db:seed                         # districts and the [ÖRNEK] sample venues
docker compose -f docker-compose.yml -f apps/mobile/e2e/compose.e2e.yml up -d --build --wait web worker
```

`compose.e2e.yml` only raises the auth rate limit of this local stack: the seed and the flows sign
in many times from one address within minutes.

## 2. Seed the flow data

```sh
cd apps/mobile
node e2e/seed.mjs
```

The script registers fresh accounts for this run (`e2e-<role>-<run>@example.com`, one random
password), marks their addresses verified, sets their district and creates the teams, the invite,
the matches and the open call the flows use. It writes the values to `e2e/.env.e2e` (ignored by
git). Run it again before every full run; earlier runs are never reused.

Options (environment): `KADRO_E2E_API_URL` (default `http://localhost:3000`), `POSTGRES_USER` /
`POSTGRES_DB` (default `kadro`), `KADRO_E2E_DB_CONTAINER` (a container name, when the database
does not run as the compose `postgres` service).

## 3. Build and install the app

```sh
cd apps/mobile
EXPO_PUBLIC_APP_ENV=local EXPO_PUBLIC_API_URL=http://localhost:3000 pnpm exec expo run:android
adb reverse tcp:3000 tcp:3000
```

`expo run:android` writes `android/` (ignored by git), builds the debug variant, installs it on
the running emulator and starts Metro. The debug build loads JavaScript from Metro and is the only
variant that may use plain HTTP to loopback hosts (`plugins/android-network-security.js`); release
builds refuse it. `adb reverse` makes `localhost:3000` on the emulator reach the API on the host.

## 4. Run the flows

```sh
cd apps/mobile
node e2e/run-flows.mjs                            # every flow, in the order of .maestro/config.yaml
node e2e/run-flows.mjs .maestro/flows/rsvp.yaml   # one flow
```

Reports and screenshots go to `e2e/output/` (JUnit `report.xml`). `maestro check-syntax <file>`
checks a flow file without a device.

## CI

`.github/workflows/kadro-mobile-e2e.yml` runs the same steps on `ubuntu-latest` with
`reactivecircus/android-emulator-runner`, on manual dispatch only. It is a second proof next to a
run on a developer machine, not a required check.

## Limits

- Android only. iOS runs need a Mac or a `macos-latest` runner and are not part of this setup.
- `GET /api/v1/districts` is served by the API. No flow depends on the district pickers (the seed
  sets the district through `PATCH /me`), so they are not exercised.
- Apple and Google sign-in, push delivery, photo upload and verified https links are not covered:
  they need store accounts, an EAS project or a public domain.
