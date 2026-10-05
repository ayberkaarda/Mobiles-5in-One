# Çetele — Contributor Rules

- Language: code/docs/commits English; product copy Turkish (tr-TR), English secondary.
- Phase discipline per the product spec (§10); stop and report at gates; wait for "devam".
- Never run git commands. Propose Conventional Commits in reports.
- Money = Long minor units (kuruş), TRY only; ledger entries immutable (reversals).
- No placeholders; sample data only when clearly labeled [ÖRNEK].
- Ownership table (copy of spec §9); handoffs via docs/handoffs/.
- Security: 23-item checklist is a hard requirement; docs/security/verification-matrix.md maintained.
- Commands: android: ./gradlew :app:assembleDebug | :app:testDebugUnitTest | :app:connectedDebugAndroidTest | detekt ; server: ./gradlew test | bootRun | dependencyCheckAnalyze | jibDockerBuild ; docker compose up
- Env: server secrets via environment only; android via local.properties (gitignored) — documented keys in docs/ops/env.md.
- Parallel work only on disjoint ownership sets (§9).

## Repository decisions

Recorded 2026-10-05, decided by the owner. Where this section differs from the block above, this
section wins for this repository.

### Git

- Local commits are made by whoever does the work. Stage with `git add <explicit file list>` (never
  `git add -A` or `git add .`), one commit per logical group. Commit messages are English
  Conventional Commits, `type(scope): subject`, one line.
- Scopes come from `kadro/commitlint.config.mjs`. Çetele uses `android`, `server`, `brand`, `ci`,
  `docs`, `adr`, `security`, `ops`, `repo` and `deps`. A new scope is added to that file by the
  owner, not by a feature branch.
- Push, pull request, merge, tag and release are the owner's actions only.
- This replaces the line "Never run git commands" in the block above for this repository.
- Do not rewrite history (`reset`, `rebase`, `filter-repo`, anything with `--force`) without an
  explicit instruction from the owner for that single call.

### Monorepo paths

- Çetele lives under `cetele/` in the monorepo. Every path in the product spec and in the block
  above is relative to `cetele/` (`cetele/android`, `cetele/server`, `cetele/brand`,
  `cetele/docs`).
- Workflows live at the Git root, not under `cetele/`: `.github/workflows/cetele-ci.yml` (spec
  `ci.yml`) and, in Phase 6, `.github/workflows/cetele-security.yml` (spec `security.yml`).
- `.gitleaks.toml`, `renovate.json` and `lefthook.yml` at the Git root are shared with the other
  products and are changed by the owner only.
- Handoffs (spec §9) are written to `cetele/docs/handoffs/`; the rules are in
  [docs/handoffs/README.md](docs/handoffs/README.md).

### Commands

CI, this file and the docs use exactly these commands, run from the directory named.

| Area    | Directory        | Command                                                                                             |
| ------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| android | `cetele/android` | `./gradlew ktlintCheck detekt :app:testDebugUnitTest :app:assembleDebug`                            |
| server  | `cetele/server`  | `./gradlew check` (`ktlintCheck` and `test`; tests use Testcontainers PostgreSQL 16 through Docker) |
| server  | `cetele/server`  | `./gradlew bootRun`                                                                                 |
| server  | `cetele/server`  | `./gradlew jibDockerBuild`                                                                          |
| stack   | `cetele`         | `docker compose up -d --wait`                                                                       |
| health  | any              | `curl http://127.0.0.1:60080/actuator/health` returns `{"status":"UP"}`                             |
| brand   | repository root  | `node cetele/brand/scripts/validate-tokens.mjs` (Node 22, no dependencies)                          |

Later phases add `:app:connectedDebugAndroidTest`, `dependencyCheckAnalyze` and the security
workflow commands; they are written here when they exist. The Android gate is a green
`:app:assembleDebug` together with `ktlintCheck`, `detekt` and `:app:testDebugUnitTest`. Both Gradle
roots use the JDK 21 toolchain and their own wrapper; the resolved versions are recorded in the
stack ADR (see [docs/adr/README.md](docs/adr/README.md)).

### Environment files

- Server secrets come from the environment only. `application.yml` uses `${VAR}` placeholders, and
  there is no `application-prod.yml` in the repository.
- `cetele/.env.example` holds an empty value or a documented dummy that is valid only locally. It
  never contains `TODO`, `FIXME`, `lorem` or `YOUR_` text, and never a value shaped like a real key.
- Android reads `cetele.apiBaseUrl` from `cetele/android/local.properties` (gitignored) into
  `BuildConfig.API_BASE_URL`. Debug builds fall back to `http://10.0.2.2:60080`; a release build
  fails when the key is missing.
- Every key is documented in [docs/ops/env.md](docs/ops/env.md) with the phase that binds it.

### Ownership (copy of spec §9)

| Owner      | Owns (exclusive write)                                                                                                                            | Reads                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `lead`     | `docs/adr/**`, `docs/handoffs/**`, `docs/api/**`, `brand/**`, `CONTRIBUTING.md`, root configs, `docker-compose.yml`                               | everything                       |
| `server`   | `server/**` except web paths                                                                                                                      | ADRs, brand                      |
| `android`  | `android/**`                                                                                                                                      | `docs/api/openapi.json`, brand   |
| `web`      | `server/src/main/resources/templates/**`, `server/src/main/resources/static/**`, `server/src/main/kotlin/app/cetele/server/web/**`, `docs/seo/**` | brand, ADRs                      |
| `security` | `docs/security/**`, `server/src/test/kotlin/app/cetele/server/security/**`, `.github/workflows/security.yml`, `ops/backup/**`                     | everything (read-only elsewhere) |
| `qa`       | `android/app/src/androidTest/**`, `server/src/test/kotlin/app/cetele/server/contract/**`, `.github/workflows/ci.yml`                              | everything                       |

Phase 0 note: the lead delegated `docs/**` and `brand/**` to separate workers for Phase 0 only.
`docs/seo/**` has no work in Phase 0. Parallel work happens only on disjoint ownership sets, and
a shared file (build files, lockfiles, root configs) has exactly one owner.

### Product rules that bind every change

- Money is `Long` kuruş (`BIGINT` in PostgreSQL), currency fixed to `TRY`. Never `Double` or
  `Float` for an amount.
- Ledger entries are immutable. A correction is a reversing entry linked by `reversed_by`.
- No placeholders: no `TODO`, `FIXME`, `lorem`, `YOUR_` text and no stubbed function in code.
- Sample data is allowed only when it is labelled `[ÖRNEK]`. Legal pages are labelled as samples
  and claim no compliance (see the portfolio delivery scope ADR in [docs/adr](docs/adr/README.md)).
- A claim such as "passes" or "verified" always carries the command and its real output. A check
  that was not run is written as `not exercised: <reason>`.
