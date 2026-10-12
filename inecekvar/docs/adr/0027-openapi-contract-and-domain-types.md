# ADR-0027: OpenAPI contract and the derived domain types

- Status: Accepted
- Deciders: Project owner (decision delegated to the lead)
- Phase: 2, package 2E

## Context

Section 5 asks for the OpenAPI document emitted by FastAPI at `docs/api/openapi.json` and the
TypeScript types derived into `libs/domain` with `openapi-typescript`, with a CI freshness
check. Section 9 makes `lead` the owner of `docs/api/**` and `libs/domain/**`.

## Decision

- `uv run python -m app.contract` (`api/app/contract.py`) builds the real app with local
  settings (per-process keys, no connection opened) and writes `docs/api/openapi.json` with
  2-space indentation and a trailing newline. The output is deterministic (two runs compared
  byte for byte).
- `node libs/domain/scripts/build-api-types.mjs` derives `libs/domain/src/lib/api.ts` with
  `openapi-typescript` 7.13.0 (pinned exactly in `package.json`, released 2026-02-11) through its
  Node API (`alphabetize`, `exportType`), formats it with the workspace Prettier config and adds
  its own two-line header (the library's default banner is not used). `libs/domain` exports the
  types as `ApiPaths`, `ApiComponents` and `ApiOperations`; `--check` exits 1 when stale.
- CI (`.github/workflows/inecekvar-ci.yml`): the API job regenerates the contract after the type
  check (`mypy --strict app tests alembic`) and fails on `git diff --exit-code` of
  `docs/api/openapi.json`; the workspace job regenerates the types and fails on a diff of
  `libs/domain/src/lib/api.ts`. A route change therefore needs the contract and the types in
  the same commit.
- Adding `openapi-typescript` re-resolved the peer `supports-color` of several tools in
  `pnpm-lock.yaml` (7.2.0 to 10.2.2); the whole workspace was rebuilt to confirm it.

## Evidence

| # | Check | Command | Result |
| - | ----- | ------- | ------ |
| 1 | Contract written | `INECEKVAR_ENV=local uv run python -m app.contract` | 34 paths, 40 operations |
| 2 | Deterministic | second run to a temporary file, `cmp` | identical |
| 3 | Types fresh | `node libs/domain/scripts/build-api-types.mjs --check` | "matches docs/api/openapi.json" |
| 4 | Workspace still builds | `pnpm nx run-many -t lint test build` | 5 projects, 12 tasks, success |
| 5 | Formatting | `pnpm exec prettier --check .` | all files formatted |
| 6 | Workflow syntax | `go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 .github/workflows/inecekvar-ci.yml` | no findings |

Not exercised:

- `not exercised: the CI run itself` (branch not pushed).
- `not exercised: OWASP ZAP API scan from openapi.json` (phase 6).
