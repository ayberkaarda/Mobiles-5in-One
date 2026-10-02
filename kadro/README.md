English | [Türkçe](README.tr.md)

# Kadro

Match organizer for amateur pitch football (halı saha). Build your squad, find the missing player,
split the pitch fee. No money moves inside the app; the captain only tracks who has paid.

## Status

In development. Phase 0 (foundation) and Phase 1 (data model, authentication, security core) are
complete. The domain API, the mobile app, the SEO pages, subscriptions and the admin area are
planned and not yet implemented.

`apps/mobile` is a scaffold (Expo Router entry screens), `apps/worker` is a runnable skeleton with
logging, and `apps/web` currently serves the authentication API (`/api/v1/auth/*`, `/api/v1/me`,
`/api/v1/health`) and a placeholder home page.

## MVP features

| Feature                                                                           | Status                             |
| --------------------------------------------------------------------------------- | ---------------------------------- |
| Email + password registration and login, Apple and Google sign-in, password reset | Implemented (auth API, Phase 1)    |
| Database schema, migrations and seed data (districts, sample venues)              | Implemented (Phase 1)              |
| Teams, roles (captain, co-captain, player), invite links                          | Planned (Phase 2)                  |
| Matches, RSVP with waitlist, lineup with position balancing                       | Planned (Phase 2 API, Phase 3 app) |
| Fee split and paid/unpaid tracking                                                | Planned (Phase 2 API, Phase 3 app) |
| Open calls ("Eksik Var"): publish a missing-player call, browse and apply         | Planned (Phase 2 API, Phase 3 app) |
| Venue directory ("Saha Rehberi") with ratings and reviews                         | Planned (Phase 2 API, Phase 3 app) |
| Reminders and notifications (push, email) through the worker                      | Planned (Phase 2)                  |
| MVP vote and basic player stats                                                   | Planned                            |
| Kadro Pro subscription (RevenueCat), server-enforced entitlements                 | Planned (Phase 5)                  |
| Account deletion in the app and on the web                                        | Planned                            |
| Marketing site, venue pages, open-call listings, invite landing pages             | Planned (Phase 4)                  |

Explicit non-goals for the MVP: in-app payments between players, venue booking integration, live
chat, video, ads, leagues and tournaments, languages other than Turkish and English.

## Technology stack

- Mobile: Expo (React Native), Expo Router, TypeScript
- Web and API: Next.js (App Router), REST under `/api/v1`
- Database: PostgreSQL 16 with PostGIS, Drizzle ORM and SQL migrations
- Background jobs: pg-boss (worker app)
- Validation and contracts: zod
- Passwords: Argon2id; access tokens: ES256 JWT; refresh tokens with rotation
- Tooling: pnpm workspaces, Turborepo, Vitest, ESLint, Prettier

Exact pinned versions and the reasoning behind them are in
[`docs/adr/0001-stack-and-versions.md`](docs/adr/0001-stack-and-versions.md).

## Repository structure

```
apps/
  mobile/      Expo app (scaffold)
  web/         Next.js: API (/api/v1) and web pages
  worker/      pg-boss job runner
packages/
  auth/        authorization policy, password hashing, token utilities
  brand/       design tokens, logo SVGs, fonts
  config/      validated environment configuration (only reader of process.env)
  contracts/   zod schemas and shared types
  db/          Drizzle schema, migrations, seed data
docs/
  adr/         architecture decision records
  handoffs/    cross-package hand-off notes
  ops/         hosting and operations
  security/    authorization matrix, threat model, verification matrix
```

## Requirements

- Node.js: the version in [`.nvmrc`](.nvmrc) (the `engines` field requires at least 22.12.0)
- pnpm: the version pinned in the `packageManager` field of [`package.json`](package.json)
- Docker, for the local database and for the database-backed tests

## Setup and running

All commands run from this directory (`kadro/`).

```sh
pnpm install
cp .env.example .env
pnpm --silent --filter @kadro/config secrets:generate
```

`secrets:generate` prints the signing keys, CSRF secret and hash secret; paste them over the empty
keys in `.env`. The web app refuses to start while they are empty.

```sh
pnpm db:up                           # PostgreSQL + PostGIS in Docker
pnpm build                           # workspace packages must be built first
pnpm --filter @kadro/db db:migrate   # apply migrations
pnpm --filter @kadro/db db:seed      # districts and [ÖRNEK] sample venues
pnpm dev                             # web on http://localhost:3000 and the worker
```

Other commands:

| Command                                       | Purpose                                            |
| --------------------------------------------- | -------------------------------------------------- |
| `pnpm worker:dev`                             | worker only                                        |
| `pnpm mobile:start`                           | start the Expo dev server                          |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | lint, type-check and build every package           |
| `pnpm test`                                   | run all tests                                      |
| `pnpm format` / `pnpm format:check`           | write or check Prettier formatting                 |
| `docker compose up --build`                   | full stack in containers (web + worker + database) |

## Environment variables

[`.env.example`](.env.example) lists every variable with comments. Values are local-development
dummies except the signing keys, CSRF secret and hash secret, which are intentionally empty and
created per machine with `pnpm --silent --filter @kadro/config secrets:generate`. Real values for
preview and production belong in the hosting provider's secret store, never in the repository.
Apps fail fast at boot when a required variable is missing or invalid.

## Tests

`pnpm test` runs the Vitest suites of every package. The database tests (`@kadro/db`) and the web
API tests (`@kadro/web`) start a disposable PostGIS container, so a running Docker daemon is
required; without one they fail with an explicit message.

## Security approach

Authorization is enforced server-side from a documented matrix; secrets are never committed;
refresh tokens, invite codes and email tokens are stored only as hashes; authentication endpoints
are rate-limited; responses carry strict headers and per-surface CSP. CI scans the full history for
secrets and audits dependencies. Details:

- [`docs/security/authorization-matrix.md`](docs/security/authorization-matrix.md)
- [`docs/security/threat-model.md`](docs/security/threat-model.md)
- [`docs/security/verification-matrix.md`](docs/security/verification-matrix.md)
- [`docs/security/history-purge-runbook.md`](docs/security/history-purge-runbook.md)
- [`docs/adr/`](docs/adr/) (security-relevant decisions such as ADR 0011, 0014, 0015, 0019, 0021)

## Documentation

- [`docs/adr/README.md`](docs/adr/README.md): index of architecture decision records
- [`docs/security/`](docs/security/): security documents
- [`docs/ops/README.md`](docs/ops/README.md): hosting and operations
- [`docs/handoffs/`](docs/handoffs/): hand-off notes between packages

No OpenAPI document is committed yet; it is planned together with the domain API.

## Roadmap

- Phase 0, foundation: done
- Phase 1, data, auth and security core: done
- Phase 2, domain API and worker jobs (teams, matches, open calls, venues, uploads, reminders)
- Phase 3, mobile app
- Phase 4, web SEO pages and public listings
- Phase 5, Kadro Pro subscription, webhook and admin area
- Phase 6, hardening and release readiness

## License

The packages are marked `UNLICENSED` in their `package.json` files; the repository has no
`LICENSE` file.
