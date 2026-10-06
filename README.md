English | [Türkçe](README.tr.md)

# Mobil-Package

A monorepo of five independent mobile products. Each product lives in its own folder with its own
stack, tooling and release cycle; nothing is shared between them.

## Projects

| Folder                    | Product                                                                                                               | Stack                                                                          | Status                                                    | Progress |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- | -------- |
| [`kadro`](kadro/)         | Match organizer for amateur pitch football: build the squad, fill missing players, split the pitch fee                | Expo (React Native), Next.js, PostgreSQL + PostGIS, pg-boss                    | All planned phases merged (real-world proofs partly open) | 100%     |
| [`askida`](askida/)       | Pay-it-forward network: donors prepay everyday items at verified local shops, recipients collect with a one-time code | Flutter, Laravel, PostgreSQL + PostGIS, Redis, iyzico                          | All planned phases merged (real-world proofs partly open) | 100%     |
| [`cetele`](cetele/)       | Offline-first digital credit ledger (veresiye defteri) for small shop owners                                          | Kotlin (Jetpack Compose), Spring Boot, PostgreSQL                              | Design document only, no code                             | 0%       |
| [`inecekvar`](inecekvar/) | Crowdsourced dolmus / minibus route map for Turkish cities with A to B planning and offline city packs                | Ionic (Angular + Capacitor), Angular SSR, FastAPI, PostgreSQL + PostGIS, Redis | Design document only, no code                             | 0%       |
| [`patika`](patika/)       | Community platform for street animals: feeding-station map, check-ins, adoption listings, vet directory               | .NET MAUI (C#), ASP.NET Core, PostgreSQL + PostGIS                             | Design document only, no code                             | 0%       |

## Gallery

One card per project. Kadro and Askıda have applications. The Askıda card shows its brand system and three app screens (Android emulator, sample data); the full set is in [`askida/README.md`](askida/README.md#screenshots). The other cards are placeholders for products that are still in the design stage.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/kadro.png" alt="Kadro: web home page and mobile lineup screen, sample data" width="100%"><br>
      <sub><b>Kadro</b>: in development</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/askida.png" alt="Askıda: brand system and foundation" width="100%"><br>
      <img src="askida/docs/release/screenshots/01-recipient-nearby.png" alt="Askıda recipient mode: nearby shops, sample data" width="32%">
      <img src="askida/docs/release/screenshots/04-donor-donate.png" alt="Askıda donor mode: item and quantity, sample data" width="32%">
      <img src="askida/docs/release/screenshots/16-merchant-home.png" alt="Askıda merchant mode: shop home, sample data" width="32%"><br>
      <sub><b>Askıda</b>: brand system and Android app screens (sample data)</sub>
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

Askıda has all seven planned phases: the Laravel server in Docker (authentication, shops and
catalog, hooks, donations with the iyzico payment flow, webhooks, payouts, the Filament admin
panel, an OpenAPI contract), the Flutter app for donors, merchants and anonymous recipients, the
public web with SEO and GEO, and the hardening phase (attack suite, stored-XSS sweep, ZAP and
MobSF scans, dependency audits, encrypted backups with a restore drill, a send budget, release and
store documents). The final security verification matrix records 14 of 23 items as done and 9 as
partial; the partial ones need systems that do not exist here (a payment provider account, store
accounts, a domain and host, error tracking, a production backup bucket, macOS) or run only after
the push. Real payments and attestation have not been exercised and iOS has never been built. See
[`askida/README.md`](askida/README.md) and
[`askida/docs/security/verification-matrix.md`](askida/docs/security/verification-matrix.md).

Cetele, Inecek Var and Patika currently consist of a single specification document each.
No application code exists for them yet.

### Progress

Last updated: 2026-10-05 (written for the merge of Askıda Phases 4 to 6). The figures are estimates, refreshed whenever a batch of work merges.

| Project     | Progress | Basis                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `kadro`     | 100%     | Phases 0 to 2 done; Phases 3 to 5: 34 of 34 work packages merged; Phase 6: 11 of 11 deliverables merged. Seven phases weighted equally: (3 + 3 x 34/34 + 11/11) / 7 = 100%. Phase 6 is complete for the portfolio scope (all 11 deliverables merged), while proofs that need systems that do not exist yet stay recorded as partial (10 of 23 security items, hosted origin, EAS builds, provider accounts, iOS), so 100% means the planned work is merged, not that every control is proven in production.                                                                   |
| `askida`    | 100%     | Phases 0 to 6 merged: 7 of 7 phases, weighted equally (foundation; data layer, authentication and security baseline; shops, accounts and hooks; payments, webhooks, payouts and admin panel; Flutter app; public web, SEO and GEO; hardening and release readiness): 7/7 = 100%. 100% means the planned work is merged, not that every control is proven in production: 9 of 23 security items stay partial ([verification matrix](askida/docs/security/verification-matrix.md)); real payments, real attestation, store accounts, a hosted origin and iOS are not exercised. |
| `cetele`    | 0%       | Specification only; no code yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `inecekvar` | 0%       | Specification only; no code yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `patika`    | 0%       | Specification only; no code yet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

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
