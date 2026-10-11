# Contributing

## Language and delivery

Code, identifiers, commits and documentation are in English. User-facing product copy is Turkish (`tr-TR` first, English second). Work follows the delivery phases in the product specification. At each phase end, stop, report with the specification's report format and wait for the owner's explicit `devam`.

Keep changes within the product scope. Do not invent real-world route data or add placeholders. Development sample content must be labeled `[ÖRNEK] Test Şehri`. Do not run Git operations without explicit approval. Propose Conventional Commit messages in phase reports.

## Privacy and authentication

Raw GPS traces are private to their owner and moderators, are never exposed through public endpoints, and are deleted 30 days after the derived line version is published. Logs round coordinates to three decimal places. Web and PWA authentication uses an HttpOnly session cookie and CSRF header. Native authentication keeps the access token in memory and the refresh token in secure storage. Both follow the shared `AuthStrategy` contract.

## Ownership and handoffs

| Owner | Exclusive write areas | Reads |
| --- | --- | --- |
| lead | `docs/adr/**`, `docs/handoffs/**`, `docs/api/**`, `brand/**`, `libs/domain/**`, `libs/ui/**`, this file, root configuration, Compose file, Caddy configuration | Everything |
| api | `api/**`, `ops/backup/**` | ADRs |
| mobile | `apps/mobile/**`, `libs/data-access/**` | API contract, brand, libraries |
| web | `apps/web/**`, `docs/seo/**` | Brand and libraries |
| security | `docs/security/**`, API security tests, security workflows and operations | Everything read-only elsewhere |
| qa | Web and mobile end-to-end tests, CI workflow | Everything |

Cross-area work uses `docs/handoffs/<from>-to-<to>-<NNN>.md`. API contract changes go through lead, from `docs/api/openapi.json` to domain types.

## Security requirements

The 23 requirements in section 6 of the product specification are mandatory and tracked in `docs/security/verification-matrix.md`. Authorization rules and resource ownership belong on the API; interface guards are for user experience only. Follow the plugin allowlist in ADR-0004. Keep secrets out of source control.

## Development commands

From `inecekvar/`:

```sh
docker compose up -d
pnpm nx serve mobile
pnpm nx serve web
pnpm nx run-many -t lint test build
pnpm exec prettier --check .
```

From `inecekvar/api/`:

```sh
uv sync --locked
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 57800
uv run ruff check .
uv run ruff format --check .
uv run mypy --strict app tests
uv run pytest
```

Compose runs only the data and proxy services; the API and both dev servers run on the host, and Caddy reaches the API on port 57800. From Phase 1, API secrets are loaded only through `pydantic-settings` (not installed in Phase 0, where the API reads no environment variable). Angular environment files contain public values only. Document environment keys in `docs/ops/env.md`; `.env.example` contains local development values and no secrets.

