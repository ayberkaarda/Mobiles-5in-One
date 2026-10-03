English | [Türkçe](README.tr.md)

# Mobil-Package

A monorepo of five independent mobile products. Each product lives in its own folder with its own
stack, tooling and release cycle; nothing is shared between them.

## Projects

| Folder                    | Product                                                                                                               | Stack                                                                          | Status                                                    | Progress |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- | -------- |
| [`kadro`](kadro/)         | Match organizer for amateur pitch football: build the squad, fill missing players, split the pitch fee                | Expo (React Native), Next.js, PostgreSQL + PostGIS, pg-boss                    | All planned phases merged (real-world proofs partly open) | 100%     |
| [`askida`](askida/)       | Pay-it-forward network: donors prepay everyday items at verified local shops, recipients collect with a one-time code | Flutter, Laravel, PostgreSQL + PostGIS, Redis, iyzico                          | Foundation merged (Phase 0); no product features yet      | ~14%     |
| [`cetele`](cetele/)       | Offline-first digital credit ledger (veresiye defteri) for small shop owners                                          | Kotlin (Jetpack Compose), Spring Boot, PostgreSQL                              | Design document only, no code                             | 0%       |
| [`inecekvar`](inecekvar/) | Crowdsourced dolmus / minibus route map for Turkish cities with A to B planning and offline city packs                | Ionic (Angular + Capacitor), Angular SSR, FastAPI, PostgreSQL + PostGIS, Redis | Design document only, no code                             | 0%       |
| [`patika`](patika/)       | Community platform for street animals: feeding-station map, check-ins, adoption listings, vet directory               | Swift (SwiftUI), ASP.NET Core, PostgreSQL + PostGIS                            | Design document only, no code                             | 0%       |

## Gallery

One card per project. Only Kadro has an application. The Askıda card shows its brand system and foundation; that app does not exist yet. The other cards are placeholders for products that are still in the design stage.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/kadro.png" alt="Kadro: web home page and mobile lineup screen, sample data" width="100%"><br>
      <sub><b>Kadro</b>: in development</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/askida.png" alt="Askıda: brand system and foundation, no app screens yet" width="100%"><br>
      <sub><b>Askıda</b>: brand system and foundation, no app screens yet</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/cetele.png" alt="Cetele card: in design stage, no app yet" width="100%"><br>
      <sub><b>Cetele</b>: in design stage, no app yet</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/inecekvar.png" alt="Inecek Var card: in design stage, no app yet" width="100%"><br>
      <sub><b>Inecek Var</b>: in design stage, no app yet</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/patika.png" alt="Patika card: in design stage, no app yet" width="100%"><br>
      <sub><b>Patika</b>: in design stage, no app yet</sub>
    </td>
    <td width="50%"></td>
  </tr>
</table>

## Status

Kadro's planned phases are all merged. Its repository foundation, Phase 1 (data model,
authentication and the security core) and Phase 2 (domain API and worker jobs) are complete, all
work packages of Phases 3 to 5 (mobile app, SEO pages, subscriptions and the admin area) are
merged, and all Phase 6 deliverables (hardening and release readiness) are merged: attack suite,
ZAP and MobSF scans, dependency audit report, restore drill, cost document and cost guard,
history-purge runbook, ASO, store listing copy, privacy labels, the final 23-item verification
matrix and the SEO and GEO checklist. Open proofs are recorded as such:
10 of the 23 matrix items are partial, the Lighthouse lab LCP is 2.5 to 2.7 s on three pages, and
the new CI steps have not run in GitHub Actions yet. The missing proof needs systems that do not
exist yet (EAS builds, a hosted origin, a Sentry account, provider accounts, backup storage, iOS).
Merged does not mean verified in the real world: purchases have not run against real store
accounts, and legal and store texts are samples. The redesign (ADR-0084: light and dark schemes,
Archivo type, a squad-sheet look on the web and in the app) is merged; the mobile Maestro flows
pass 11 of 11 on an emulator, but no physical device run exists. See
[`kadro/README.md`](kadro/README.md) for the detailed breakdown.

Askıda has a foundation and no product features: the Laravel server runs in Docker (health route,
Filament admin panel, Horizon, Sanctum), the Flutter app is a skeleton with a design system, and the
brand package, six ADRs, security matrix drafts and a CI workflow are in place. It has no
endpoints, no payments and no screens beyond a mode shell; iOS has never been built. See
[`askida/README.md`](askida/README.md).

Cetele, Inecek Var and Patika currently consist of a single specification document each.
No application code exists for them yet.

### Progress

Last updated: 2026-10-04 (after the Kadro redesign and the Askıda foundation merges). The figures are estimates, refreshed whenever a batch of work merges.

| Project     | Progress | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kadro`     | 100%     | Phases 0 to 2 done; Phases 3 to 5: 34 of 34 work packages merged; Phase 6: 11 of 11 deliverables merged. Seven phases weighted equally: (3 + 3 x 34/34 + 11/11) / 7 = 100%. Phase 6 is complete for the portfolio scope (all 11 deliverables merged), while proofs that need systems that do not exist yet stay recorded as partial (10 of 23 security items, hosted origin, EAS builds, provider accounts, iOS), so 100% means the planned work is merged, not that every control is proven in production. |
| `askida`    | ~14%     | Phase 0 (foundation) merged: 1 of 7 phases, weighted equally. Phase 1 (Laravel core, authentication, security baseline) is in progress on branches and not counted. No endpoints, no payments and no screens beyond a mode shell yet; iOS never built.                                                                                                                                                                                                                                                      |
| `cetele`    | 0%       | Specification only; no code yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `inecekvar` | 0%       | Specification only; no code yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `patika`    | 0%       | Specification only; no code yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

Progress means merged into `main`; work that is only on a branch or in an open pull request is not
counted. 100% means all phases are merged; real-world verification is tracked separately.

## Repository layout

```
.github/workflows/   CI for Kadro (lint, typecheck, build; security scans, mobile end-to-end,
                     restore drill) and for Askıda
.gitleaks.toml       secret-scanning configuration
lefthook.yml         git hook configuration
kadro/               Kadro monorepo (pnpm workspaces + Turborepo)
askida/              Askıda: Laravel server (Docker), Flutter app, brand package, ADRs, spec
cetele/              design document
inecekvar/           design document
patika/              design document
```

## Documentation per project

- Kadro: [`kadro/README.md`](kadro/README.md) ([Türkçe](kadro/README.tr.md))
- Askıda: [`askida/README.md`](askida/README.md) ([Türkçe](askida/README.tr.md)); also
  [`askida/CONTRIBUTING.md`](askida/CONTRIBUTING.md) and the ADRs in `askida/docs/adr/`
- Cetele: [`cetele/README.md`](cetele/README.md) ([Türkçe](cetele/README.tr.md))
- Inecek Var: [`inecekvar/README.md`](inecekvar/README.md) ([Türkçe](inecekvar/README.tr.md))
- Patika: [`patika/README.md`](patika/README.md) ([Türkçe](patika/README.tr.md))

## Development

Kadro and Askıda are buildable; the other three projects have no code. Kadro: work from inside `kadro/`:

```sh
cd kadro
pnpm install
pnpm lint
pnpm typecheck
pnpm build
pnpm test
```

Database-backed tests need a running Docker daemon. Requirements, environment setup and all other
commands are described in [`kadro/README.md`](kadro/README.md).

Askıda server (needs Docker; no host PHP), from inside `askida/`:

```sh
cd askida
docker compose up -d --wait
docker compose exec server php artisan test
```

Askıda app (needs the Flutter SDK), from inside `askida/app/`:

```sh
cd askida/app
flutter pub get
flutter analyze
flutter test
dart format --set-exit-if-changed .
```

The repository uses Conventional Commits, checked by commitlint through the hooks in
`lefthook.yml`. Hooks are installed explicitly with `pnpm --dir kadro exec lefthook install`.

## License

Kadro's packages are marked `UNLICENSED` in their `package.json` files. The repository has no
`LICENSE` file.
