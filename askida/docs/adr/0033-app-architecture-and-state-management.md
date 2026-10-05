# ADR-0033: App architecture and state management

- Status: Accepted
- Date: 2026-10-04
- Deciders: Ayberk (owner) delegated engineering decisions inside the specification.

## Context

The Flutter app serves three modes (recipient, donor, merchant) from one codebase and talks to one API
(ADR-0010, ADR-0013). Several parts were built in parallel, so the structure had to let each part own
its own files and still plug into one router, one data layer and one set of fakes for tests.

## Options considered

1. Layer-first folders (`screens/`, `models/`, `services/`): simple, but every feature touches every
   folder.
2. Feature-first folders with a shared data layer: each feature owns its screens and rules; the API,
   models, routing and storage are shared.
3. Riverpod providers produced by codegen: less boilerplate, one more generator in the build.

## Decision

- **Feature-first layout.** `lib/features/<feature>/` holds `data/` (feature-specific
  implementations), `domain/` (rules, no Flutter imports where possible) and `presentation/` (screens,
  widgets, providers). App-wide code lives in `lib/core` (HTTP client, storage, push, attestation,
  errors, links), `lib/data` (models, repository interfaces and implementations, providers, session),
  `lib/design` (theme and signature components) and `lib/routing`.
- **State with Riverpod, providers written by hand** (`Provider`, `AsyncNotifier`); no globals, and
  no providers produced by codegen. Every dependency a screen needs (repositories, token store, clock,
  location service, tile provider, push service, identity provider, attestation service) is a provider
  that tests override. Automatic provider retry (on by default in Riverpod 3) is switched off on
  the screen-loading providers so a failure shows its message and a retry button at once.
- **Repositories behind interfaces.** `AuthRepository`, `AnonRepository`, `ShopsRepository`,
  `HooksRepository`, `DonationsRepository`, `PayoutsRepository`, `ImpactRepository` and
  `PushRepository` are abstract interfaces in `lib/data/repositories`; dio implementations and in-memory
  fakes exist for each. Feature code uses the interfaces only, through providers.
- **Models** are freezed classes with `json_serializable`, wire keys in snake_case. Money is an integer
  in kurus (`Money(int minor)`) formatted as `₺45,00`; no floating point money (ADR-0014).
- **Navigation with go_router.** Each feature exports `List<RouteBase> <feature>Routes` from
  `lib/features/<feature>/<feature>_routes.dart`; `lib/routing/feature_routes.dart` concatenates them.
  Mode homes own their feature routes as children, so the mode shell stays around them. Guards are
  prefix based (`lib/routing/app_paths.dart`): `/merchant/...` needs a merchant account,
  `/donor/donate*` and `/donor/donation*` need a donor account, `/recipient/reserve*` and
  `/recipient/code*` need the anonymous device token. A missing account sends the user to
  `/auth?from=<location>`, the wrong kind of account to the mode home, a missing anonymous token to
  `/recipient/start?from=<location>`. Unknown locations fall back to the current mode home. Return
  locations are accepted only when they are in-app paths.
- **Sources built by codegen are not committed.** `*.g.dart`, `*.freezed.dart` and `*.drift.dart` are
  git-ignored and built with `bash tool/codegen.sh` (pub get plus build_runner); a test checks that
  they stay ignored. The CI app job runs build_runner before analyze and test (added in the
  integration step).
- **Copy.** Turkish is the default, English has key parity (ARB test). Server text is never shown:
  `ApiProblem.message(l10n)` maps the problem `code` to an ARB key, with a generic fallback.
- **Dart 3.13 constructor style.** `very_good_analysis` flags the type name in constructors, so
  constructors are written `const new(...)` and `factory fromJson(...)`; call sites are unchanged.

## Consequences

- A feature can be built, tested and replaced without touching another feature, and each repository can
  be faked in one place.
- A fresh checkout needs the codegen step before analyze or test; forgetting it shows up as missing
  part-file errors from the analyzer rather than as a silent difference.
- Hand-written providers mean more lines than codegen output, in exchange for one less generator.

## Not exercised / limits

- Evidence: `flutter analyze` clean and `flutter test` at 591 passing tests on the Phase 4 branch
  (Windows host, goldens included). iOS was not built or run (no macOS).
