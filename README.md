English | [Türkçe](README.tr.md)

# Mobil-Package

A monorepo of five independent mobile products. Each product lives in its own folder with its own
stack, tooling and release cycle; nothing is shared between them.

## Projects

| Folder                    | Product                                                                                                               | Stack                                                                          | Status                                                     | Progress |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------- | -------- |
| [`kadro`](kadro/)         | Match organizer for amateur pitch football: build the squad, fill missing players, split the pitch fee                | Expo (React Native), Next.js, PostgreSQL + PostGIS, pg-boss                    | In development (Phases 0 to 5 merged, Phase 6 in progress) | ~95%     |
| [`askida`](askida/)       | Pay-it-forward network: donors prepay everyday items at verified local shops, recipients collect with a one-time code | Flutter, Laravel, PostgreSQL + PostGIS, Redis, iyzico                          | Design document only, no code                              | 0%       |
| [`cetele`](cetele/)       | Offline-first digital credit ledger (veresiye defteri) for small shop owners                                          | Kotlin (Jetpack Compose), Spring Boot, PostgreSQL                              | Design document only, no code                              | 0%       |
| [`inecekvar`](inecekvar/) | Crowdsourced dolmus / minibus route map for Turkish cities with A to B planning and offline city packs                | Ionic (Angular + Capacitor), Angular SSR, FastAPI, PostgreSQL + PostGIS, Redis | Design document only, no code                              | 0%       |
| [`patika`](patika/)       | Community platform for street animals: feeding-station map, check-ins, adoption listings, vet directory               | Swift (SwiftUI), ASP.NET Core, PostgreSQL + PostGIS                            | Design document only, no code                              | 0%       |

## Gallery

One card per project. Only Kadro has an application; the other cards are placeholders for products that are still in the design stage.

<table>
  <tr>
    <td width="50%" align="center">
      <img src="docs/readme/kadro.png" alt="Kadro card: in development" width="100%"><br>
      <sub><b>Kadro</b>: in development</sub>
    </td>
    <td width="50%" align="center">
      <img src="docs/readme/askida.png" alt="Askida card: in design stage, no app yet" width="100%"><br>
      <sub><b>Askida</b>: in design stage, no app yet</sub>
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

Only Kadro has code. Its repository foundation, Phase 1 (data model, authentication and the
security core) and Phase 2 (domain API and worker jobs) are complete. All work packages of Phases 3
to 5 (mobile app, SEO pages, subscriptions and the admin area) are merged. Phase 6 (hardening and
release readiness) is in progress: the attack suite, restore drill and runbooks, cost guard, store
listing copy and privacy label drafts are merged; the final verification matrix, the SEO and GEO
checklist, a dependency audit report and the mobile static scan are open. Merged does not mean
verified in the real world: mobile end-to-end flows have not run on a device, purchases have not run
against real store accounts, and legal and store texts are samples. See
[`kadro/README.md`](kadro/README.md) for the detailed breakdown.

Askida, Cetele, Inecek Var and Patika currently consist of a single specification document each.
No application code exists for them yet.

### Progress

Last updated: 2026-10-03 (after the Phase 6 documentation and cost guard merge). The figures are estimates, refreshed whenever a batch of work merges.

| Project     | Progress | Basis                                                                                                                                                              |
| ----------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `kadro`     | ~95%     | Phases 0 to 2 done; Phases 3 to 5: 34 of 34 work packages merged; Phase 6: 7 of 11 deliverables merged. Seven phases weighted equally: (3 + 3 x 34/34 + 7/11) / 7. |
| `askida`    | 0%       | Specification only; no code yet.                                                                                                                                   |
| `cetele`    | 0%       | Specification only; no code yet.                                                                                                                                   |
| `inecekvar` | 0%       | Specification only; no code yet.                                                                                                                                   |
| `patika`    | 0%       | Specification only; no code yet.                                                                                                                                   |

Progress means merged into `main`; work that is only on a branch or in an open pull request is not
counted. The figure reaches 100% only after Phase 6 (hardening and release readiness) is complete.

## Repository layout

```
.github/workflows/   CI for Kadro (lint, typecheck, build; security scans)
.gitleaks.toml       secret-scanning configuration
lefthook.yml         git hook configuration
kadro/               Kadro monorepo (pnpm workspaces + Turborepo)
askida/              design document
cetele/              design document
inecekvar/           design document
patika/              design document
```

## Documentation per project

- Kadro: [`kadro/README.md`](kadro/README.md) ([Türkçe](kadro/README.tr.md))
- Askida, Cetele, Inecek Var, Patika: no README yet; the specification document in each folder is
  the only documentation.

## Development

Kadro is the only buildable project. Work from inside `kadro/`:

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

The repository uses Conventional Commits, checked by commitlint through the hooks in
`lefthook.yml`. Hooks are installed explicitly with `pnpm --dir kadro exec lefthook install`.

## License

Kadro's packages are marked `UNLICENSED` in their `package.json` files. The repository has no
`LICENSE` file.
