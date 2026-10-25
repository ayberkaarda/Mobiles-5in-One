# Contributing to Patika

Code, identifiers, commits, and documentation are written in English. User-facing product copy is Turkish (`tr-TR`) first, with English as the secondary language.

## Delivery discipline

Work follows the phases in `03-patika-swift-ios.md` §10. Stop at each phase gate, report using §11, and wait for explicit `devam` before starting the next phase. Keep work within the MVP scope in §3. Record engineering decisions in `docs/adr/`; scope, cost, and legal changes require the product owner's decision.

The 23 security requirements in §6 are hard requirements. Maintain `docs/security/verification-matrix.md` with evidence for every item. Do not mark an item complete without its verification evidence.

## Changes and repository practices

Do not run Git operations that change repository history or publish changes without explicit approval. Propose Conventional Commit messages in the phase report; do not execute them without that approval.

Do not add placeholder text or fabricated real-world data. Care-place seed rows must be clearly marked as samples (`is_sample = true`) and their names prefixed `[ÖRNEK]`. Real care-place records arrive through the admin CSV import.

Keep volunteer privacy by design: strip EXIF/GPS metadata from photos before upload; never store volunteer positions; round coordinates to three decimal places in logs. Store only public base URLs in mobile configuration. Backend secrets belong in environment variables or .NET user-secrets, never in settings committed to the repository. Document environment keys in `docs/ops/env.md`.

## Ownership and handoffs

| Owner | Exclusive write areas |
| --- | --- |
| `lead` | `docs/adr/**`, `docs/handoffs/**`, `docs/api/**`, `brand/**`, `src/Patika.Contracts/**`, this file, root configuration, `docker-compose.yml`, `Directory.*.props` |
| `api` | `src/Patika.Api/**`, `src/Patika.Domain/**`, `src/Patika.Infrastructure/**`, `src/Patika.Worker/**`, `tests/Patika.IntegrationTests/**`, `tests/Patika.UnitTests/**` |
| `mobile` | `app/**` |
| `web` | `src/Patika.Web/**`, `docs/seo/**` |
| `security` | `docs/security/**`, `tests/Patika.SecurityTests/**`, `.github/workflows/security.yml`, `ops/backup/**` |
| `qa` | `app/**` UI tests, `.github/workflows/ci.yml` |

Read access may span ownership areas. Keep concurrent changes on disjoint ownership sets. Coordinate cross-area work through `docs/handoffs/<from>-to-<to>-<NNN>.md`; contract changes flow through `lead`. The mobile client is .NET MAUI targeting Android first. This repository does not build an iOS target at this time.

## Local configuration

Backend secrets are supplied through environment variables or `dotnet user-secrets`. Mobile configuration in `app/**/Config/*.json` contains public values such as `API_BASE_URL` only. Never commit credentials, signing keys, tokens, or private certificates. Refer to `docs/ops/env.md` for the key inventory.

## Common commands

Run from the repository root:

```sh
dotnet build
dotnet test
dotnet run --project src/Patika.Api
docker compose up
dotnet format
```

Build the Android app from its project directory:

```sh
dotnet build app/Patika.App/Patika.App.csproj -f net10.0-android
```

Keep the Android target and SDK choices consistent with ADR-0001.
