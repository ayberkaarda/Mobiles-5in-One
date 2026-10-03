# Askıda — Contributor Rules

## Language

- Code, identifiers, commit messages, log text, file names and technical documentation: English.
- User-facing product copy: Turkish first (default locale `tr`), English secondary through ARB files.
- Copy never uses the words "muhtaç" or "fakir"; the product says "askıdan al".

## Product rules

1. Work in phases. Each phase ends with a report and an explicit go-ahead from the maintainer
   before the next phase starts.
2. No silent scope expansion. Anything outside the product scope is proposed in the report, not
   built.
3. No placeholders: no to-do or fix-me markers, filler text, dummy key strings, stub endpoints or invented shops.
   Shops exist only through merchant registration and admin verification. Development seeds are
   `is_sample = true` rows with the name prefix `[ÖRNEK]`; sample legal or company text is labelled
   as a sample.
4. Dignity and anonymity are product invariants. Recipients never create accounts, are never shown
   to donors or merchants by identity, are never rated, and no precise recipient location is stored.
5. Money is stored as integer minor units (kuruş) in `int` or `BIGINT`, currency `TRY`. Never a
   float. The platform never holds funds: payments flow donor -> payment provider -> merchant
   sub-merchant payout, and the platform books only its commission.
6. Decisions are recorded in `docs/adr/`. Engineering choices inside the scope are made and
   recorded; scope, cost and legal changes go to the maintainer.

## Security

The 23-item security checklist is a hard requirement. `docs/security/verification-matrix.md` is
maintained with every change that affects a row. A status is never raised without executed
evidence; checks that were not run are written as not run.

## Secrets

- No secret, key, token or credential in code, docs, tests or commit history. A value that looks
  like a secret is not used even as a dummy.
- Server configuration comes from `server/.env` (gitignored) and is read only through
  `config/*.php`; `env()` is never called outside `config/`.
- The app reads configuration from `--dart-define-from-file` JSON files under `app/env/`; only
  `env/example.json` is committed. The app carries only `API_BASE_URL`.
- Every key is documented in `docs/ops/env.md`.

## Ownership and handoffs

Each area has one owner with exclusive write access; cross-area needs go through a handoff file
`docs/handoffs/<from>-to-<to>-<NNN>.md`. API contract changes go through the lead owner
(`docs/api/openapi.yaml`).

| Owner      | Owns (exclusive write)                                                                                                                                                                                             | Reads                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| `lead`     | `docs/adr/**`, `docs/handoffs/**`, `docs/api/**`, `brand/**`, `CONTRIBUTING.md`, root configs, `docker-compose.yml`                                                                                                | everything                       |
| `api`      | `server/app/**` except `server/app/Filament/**` and `server/app/Http/Controllers/Web/**`, `server/database/**`, `server/routes/api.php`, `server/config/**`, `server/tests/Feature/Api/**`, `server/tests/Unit/**` | ADRs, openapi                    |
| `admin`    | `server/app/Filament/**`, `server/tests/Feature/Admin/**`                                                                                                                                                          | domain models (read)             |
| `flutter`  | `app/**`                                                                                                                                                                                                           | `docs/api/openapi.yaml`, brand   |
| `web`      | `server/resources/**`, `server/routes/web.php`, `server/app/Http/Controllers/Web/**`, `server/tests/Feature/Web/**`, `docs/seo/**`                                                                                 | brand, ADRs                      |
| `security` | `docs/security/**`, `server/tests/Security/**`, `.github/workflows/askida-security.yml`, `ops/backup/**`                                                                                                           | everything (read-only elsewhere) |
| `qa`       | `app/integration_test/**`, `.github/workflows/askida-ci.yml`                                                                                                                                                       | everything                       |

## Commands

App (working directory `askida/app`):

```
flutter pub get
flutter analyze
flutter test
dart format --set-exit-if-changed .
flutter run --dart-define-from-file=env/dev.json
flutter build apk --debug --flavor dev --dart-define-from-file=env/example.json
```

Server (inside the `server` compose service):

```
docker compose up
composer install
php artisan migrate --seed
php artisan test
vendor/bin/phpstan analyse
vendor/bin/pint --test
php artisan horizon
```

Health route: `GET /up`. The iOS project is created by the Flutter tool but cannot be built without macOS.

## Git

- Conventional Commits, one line, English: `type(scope): subject`.
- Types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`.
- Scopes: `repo`, `app`, `server`, `admin`, `api`, `adr`, `brand`, `security`, `ci`, `ops`, `docs`,
  `deps`.
- Branch names: `feat/<topic>`, `fix/<topic>`.
- Commits stage an explicit file list; each commit is one logical change.
- Maintainers push and merge. Contributors do not rewrite published history.
