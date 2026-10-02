# ADR-0001: Stack and pinned versions

- Status: Accepted
- Date: 2026-10-01
- Deciders: Ayberk (owner)

## Context

Kadro is a pnpm + Turborepo monorepo with an Expo mobile app, a Next.js web + REST API app, a
pg-boss worker and shared TypeScript packages. The operating contract requires the latest stable
release of every dependency at scaffold time, exact pins in manifests and the lockfile, and a
record of the resolved versions.

## Decision

Every direct dependency is pinned to an exact version (no `^`/`~`). `pnpm-lock.yaml` is the source
of truth for transitive versions. Versions below were resolved from the npm registry and Docker Hub
on 2026-10-01.

### Toolchain

| Tool                | Version                                                  | Notes                                                            |
| ------------------- | -------------------------------------------------------- | ---------------------------------------------------------------- |
| Node.js             | 22.x LTS (`>=22.12.0`), Docker image `node:22.23.3-slim` | Matches CI (`node-version: 22`). `pg-boss` requires `>=22.12.0`. |
| pnpm                | 12.8.1                                                   | `packageManager` field; installed through Corepack.              |
| Turborepo (`turbo`) | 2.11.6                                                   | Root tasks: `build`, `lint`, `typecheck`, `test`, `dev`.         |
| TypeScript          | 6.0.3                                                    | See "Deviations" below.                                          |
| PostgreSQL          | 16 with PostGIS 3.5 (`postgis/postgis:16-3.5-alpine`)    | PostGIS is required for `venues.point` (`geography(Point)`).     |

### Shared packages

| Package            | Dependency | Version |
| ------------------ | ---------- | ------- |
| `@kadro/config`    | `zod`      | 4.6.5   |
| `@kadro/contracts` | `zod`      | 4.6.5   |

### packages/db

| Dependency          | Version |
| ------------------- | ------- |
| `drizzle-orm`       | 0.45.3  |
| `pg`                | 8.23.1  |
| `uuid`              | 14.0.2  |
| `drizzle-kit` (dev) | 0.31.11 |
| `@types/pg` (dev)   | 8.23.1  |

The database image changed in Phase 1 from `postgres:16.15-alpine` to
`postgis/postgis:16-3.5-alpine`: the data model stores venue locations and district centroids as
`geography` points, which needs the PostGIS extension. The image keeps PostgreSQL major version 16;
the `16-3.5` tag floats over 16.x patch releases, so the production compose file pins the image by
digest. Production uses the same image so local, CI and production share one extension set.

### apps/web

| Dependency           | Version |
| -------------------- | ------- |
| `next`               | 16.3.8  |
| `react`, `react-dom` | 19.2.3  |
| `@types/react`       | 19.2.18 |
| `@types/react-dom`   | 19.2.7  |

### apps/mobile (Expo SDK 57)

| Dependency                       | Version |
| -------------------------------- | ------- |
| `expo`                           | 57.0.26 |
| `expo-router`                    | 57.0.24 |
| `expo-constants`                 | 57.0.20 |
| `expo-linking`                   | 57.0.11 |
| `expo-status-bar`                | 57.0.1  |
| `@expo/metro-runtime`            | 57.0.16 |
| `react-native`                   | 0.86.3  |
| `react`                          | 19.2.3  |
| `react-native-safe-area-context` | 5.7.0   |
| `react-native-screens`           | 4.26.2  |

Native module versions follow `expo/bundledNativeModules.json` for SDK 57. Two auto-installed peer
dependencies are aligned through `overrides` in `pnpm-workspace.yaml`:
`react-native-worklets` 0.10.1 and `@react-native/metro-config` 0.86.3.

### apps/worker

| Dependency  | Version |
| ----------- | ------- |
| `pg-boss`   | 12.35.1 |
| `pino`      | 10.3.1  |
| `tsx` (dev) | 4.23.15 |

### Quality tooling (root and per package)

| Dependency                                           | Version |
| ---------------------------------------------------- | ------- |
| `eslint`, `@eslint/js`                               | 9.39.5  |
| `typescript-eslint`                                  | 8.71.0  |
| `eslint-plugin-react`                                | 7.37.5  |
| `eslint-plugin-react-hooks`                          | 7.1.1   |
| `eslint-plugin-security`                             | 4.2.0   |
| `@next/eslint-plugin-next`                           | 16.3.8  |
| `eslint-config-prettier`                             | 10.1.8  |
| `globals`                                            | 17.13.0 |
| `prettier`                                           | 3.9.9   |
| `vitest`                                             | 5.0.3   |
| `vite` (Vitest peer)                                 | 8.3.2   |
| `@types/node`                                        | 22.20.4 |
| `@commitlint/cli`, `@commitlint/config-conventional` | 21.2.3  |
| `lefthook`                                           | 2.1.15  |

### Deviations from "latest" (with reason)

- **TypeScript 6.0.3 instead of 7.0.2.** `typescript-eslint` 8.71.0 declares
  `typescript >=4.8.4 <6.1.0`; type-aware linting and the parser are unsupported on 7.x. Revisit
  when `typescript-eslint` widens its peer range.
- **ESLint 9.39.5 instead of 10.x.** `eslint-plugin-react` 7.37.5 (needed for `react/no-danger`,
  security checklist item 16) supports ESLint up to 9.x only.
- **React 19.2.3 instead of 19.3.0.** Expo SDK 57 pins `react` 19.2.3. The web app uses the same
  version so the monorepo has a single React.
- **Node.js 22 instead of 24.** CI and developer machines run Node 22; all dependencies support it.
  Moving to Node 24 LTS is a separate change touching CI, `.nvmrc`, `engines` and Dockerfiles.

### Supply-chain settings

- `pnpm` 12 enforces a minimum release age for new versions. Versions published less than the
  threshold before scaffolding are listed in `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`.
  New entries require review.
- Dependency lifecycle scripts are denied by default; `allowBuilds` in `pnpm-workspace.yaml`
  allows only `esbuild`. `lefthook` is explicitly denied so git hooks are never installed as a side
  effect of `pnpm install`.

### Build layout

- Shared packages compile with `tsc` to `dist/` (ESM, `NodeNext`) and expose `exports` pointing at
  `dist`. Turborepo runs `^build` before `build`, `typecheck`, `lint` and `test`.
- `apps/web` builds with `next build` (`output: "standalone"` for the Docker image).
- `apps/mobile` "build" is `expo export` for iOS and Android, which proves the JS bundle compiles.
  Native binaries are produced by EAS Build outside the monorepo build.
- `apps/worker` compiles with `tsc` and runs with plain `node`.

## Consequences

- Upgrades are explicit: bump the pin, run `pnpm install`, update this ADR in the same change.
- The TypeScript and ESLint major versions are held back by plugin compatibility and are re-checked
  at every phase gate.
