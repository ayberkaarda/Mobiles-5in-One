# Kadro — Dependency Audit

|            |                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Item       | Security checklist item 19 (product spec §6); row 19 of `docs/security/verification-matrix.md`                                                                                                                                                    |
| Baseline   | `main` at `bf733f5`, lockfile `pnpm-lock.yaml`, pnpm 12.8.1. All commands run from `kadro/` on 2026-10-03; output copied from the real run.                                                                                                       |
| CI         | Job `Dependency audit (high and critical)` in `../.github/workflows/kadro-security.yml` runs `pnpm audit --audit-level=high` (lockfile only, no install). Last completed run on `main`: `Kadro Security` run `37125490181` on `ce091a8`, success. |
| Exceptions | Two advisories are ignored by id in `pnpm-workspace.yaml` (`auditConfig.ignoreGhsas`): ADR-0043 and ADR-0078. Nothing else is ignored and no override exists for a security reason.                                                               |

## 1. Commands and results

| Command                         | Exit | Summary line (real output)                                                            |
| ------------------------------- | ---- | ------------------------------------------------------------------------------------- |
| `pnpm audit --audit-level=high` | 0    | `3 vulnerabilities found` · `Severity: 3 moderate` · `2 ignored: 2 high`              |
| `pnpm audit --prod`             | 1    | `2 vulnerabilities found` · `Severity: 2 moderate` · `2 ignored: 2 high`              |
| `pnpm audit`                    | 1    | `3 vulnerabilities found` · `Severity: 3 moderate` · `2 ignored: 2 high`              |
| `pnpm audit --json` (metadata)  | 1    | `moderate 3, high 2, critical 0`; 693 dependencies, 446 dev, 180 optional, 1213 total |

`pnpm audit` exits 1 whenever any finding at or above its default level remains; the CI gate uses
`--audit-level=high` and exits 0. "high 2" in the JSON metadata are the two ignored advisories.

## 2. Findings

"Runtime of web / worker" means: reachable from the production dependencies of `@kadro/web` or
`@kadro/worker` (including the workspace packages they depend on). Checked with
`pnpm --filter <package> why <name> --prod` for `@kadro/web`, `@kadro/worker`, `@kadro/db`,
`@kadro/auth`, `@kadro/config` and `@kadro/contracts`; an empty answer means no production path.
Positive control: `pnpm --filter @kadro/mobile why node-forge --prod` and `... why braces --prod`
print the expected trees, so an empty answer is not a filter error.

| Package                | Advisory            | Severity | Resolved | Vulnerable / patched    | Status             | Path origin                                                                                                                                                                                                                     | Runtime of web / worker                                                                                                                                                                                             |
| ---------------------- | ------------------- | -------- | -------- | ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node-forge`           | GHSA-86w9-cpqp-85rv | high     | 1.4.0    | `<=1.4.0` / none        | ignored (ADR-0043) | `@kadro/mobile` → `expo` → `@expo/cli` (directly and through `@expo/code-signing-certificates`, which `expo-updates` also lists). Expo command line and build tooling.                                                          | No: empty `--prod` answer for all six packages. Not checked: which `expo-updates` code, if any, loads it on a device.                                                                                               |
| `braces`               | GHSA-vfj7-8cjw-p6xm | high     | 3.0.3    | `<=3.0.3` / none        | ignored (ADR-0078) | `micromatch` 4.0.8 from `@next/eslint-plugin-next` → `fast-glob` (root dev dependency, lint only) and from Metro (`@expo/metro-file-map`, `metro-file-map` through `@expo/cli`, `@expo/metro` and `react-native`'s CLI plugin). | No: empty `--prod` answer for all six packages, and `pnpm --filter @kadro/web why braces` (dev included) is empty as well.                                                                                          |
| `esbuild`              | GHSA-67mh-4wv8-2f99 | moderate | 0.18.20  | `<=0.24.2` / `>=0.25.0` | open               | `@kadro/db` dev dependency `drizzle-kit` 0.31.11 → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` (both deprecated). The advisory concerns the esbuild development server, which no script here starts.                  | No: `drizzle-kit` is a dev dependency, empty `--prod` answer. `esbuild` 0.25.12 and 0.28.2 in the lockfile are not affected.                                                                                        |
| `uuid`                 | GHSA-w5hq-g745-h8pq | moderate | 7.0.3    | `<11.1.1` / `>=11.1.1`  | open               | `@kadro/mobile` → `expo` / `expo-build-properties` → `@expo/config-plugins` → `xcode` → `uuid`; 100 paths, all through `xcode` (iOS project editing at prebuild time).                                                          | No: web and worker resolve `uuid` 14.0.2 through `@kadro/db`, which is patched.                                                                                                                                     |
| `decode-uri-component` | GHSA-vcc3-ghjq-m6fr | moderate | 0.2.2    | `<=0.4.2` / `>=0.5.0`   | open               | `@kadro/mobile` → `expo-router` → `query-string` → `decode-uri-component`; 49 paths.                                                                                                                                            | No: empty `--prod` answer for all six packages. **Mobile:** `expo-router` is app code, so this package very likely ships in the app bundle and parses deep-link query strings; not verified by inspecting a bundle. |

Notes on honesty of the table:

- The `--prod` answers were taken from `pnpm why`; the container images were not built or inspected.
  `apps/web/Dockerfile` copies the Next.js standalone output (traced files only) and
  `apps/worker/Dockerfile` uses `pnpm deploy --prod`, which matches the answers but was not checked
  file by file.
- For `@kadro/mobile`, `--prod` does not mean "shipped on the device": `expo` lists `@expo/cli` and
  Metro as dependencies. Only `decode-uri-component` is plausibly part of the app bundle.
- No reachability analysis of the vulnerable functions was done for any package.

## 3. Ignore entries and their records

```yaml
# kadro/pnpm-workspace.yaml
auditConfig:
  ignoreGhsas:
    - GHSA-86w9-cpqp-85rv
    - GHSA-vfj7-8cjw-p6xm
```

| Advisory                         | Record                                           | Reason it is ignored                                                                                         | Review and removal condition (from the ADR)                                                                                                                                                                                                                                                                                                                         | State on 2026-10-03                                                                                                                                                  |
| -------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GHSA-86w9-cpqp-85rv `node-forge` | `docs/adr/0043-node-forge-advisory-exception.md` | No patched release; only Expo CLI and code-signing tooling reach it.                                         | Remove when a patched `node-forge` exists and `@expo/cli` resolves to it (check `pnpm why node-forge` against the patched range and audit with the entry removed), or when `@expo/cli` drops the dependency. Re-check at every Expo SDK upgrade and at the close of every phase. Withdraw at once if a path from `apps/web`, `apps/worker` or `packages/*` appears. | Still applies: latest published `node-forge` is 1.4.0 (`npm view node-forge version`), the advisory lists no patched version, and no web/worker/package path exists. |
| GHSA-vfj7-8cjw-p6xm `braces`     | `docs/adr/0078-braces-advisory-exception.md`     | No patched release; reached only through lint and Metro tooling with patterns from repository configuration. | Remove when a patched `braces` exists and the tools resolve to it (check `pnpm why braces` and audit with the entry removed). Re-check at every Expo SDK or Next.js upgrade and at the close of every phase. Withdraw if `pnpm why braces --prod` shows a runtime path from `apps/web`, `apps/worker` or `packages/*`.                                              | Still applies: latest published `braces` is 3.0.3, the advisory lists no patched version, and no runtime path exists.                                                |

The audit with the entries removed was not run: removing them means editing `pnpm-workspace.yaml`,
which is outside this document's scope. The JSON metadata (`high 2`) shows that both advisories are
still reported.

## 4. Other checks from spec item 19

| Check                 | State                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm dedupe --check` | Run here: exit 0. Not a CI step.                                                                                                                                                                         |
| `npx expo-doctor`     | Run here in `apps/mobile` with `EXPO_PUBLIC_APP_ENV=local` and `EXPO_PUBLIC_API_URL=http://localhost:3000`: `21/21 checks passed`. Not a CI step.                                                        |
| Lockfile committed    | Yes, `pnpm-lock.yaml`; CI installs with `--frozen-lockfile`.                                                                                                                                             |
| `renovate.json`       | Not present. No automated update pull requests.                                                                                                                                                          |
| `syncpack`            | Not present. Version alignment of Expo-bundled packages is held by `overrides` in `pnpm-workspace.yaml` and checked by `expo-doctor`.                                                                    |
| Deprecated packages   | `pnpm dedupe --check` warns: `eslint@9.39.5` (root and `@kadro/web`, dev) and the subdependencies `@esbuild-kit/core-utils@3.3.2`, `@esbuild-kit/esm-loader@2.6.5`, `text-encoding@0.7.0`, `uuid@7.0.3`. |

## 5. Outdated packages (`pnpm outdated -r`)

25 direct dependencies have newer releases; none of them is named by an open advisory above.

Major versions behind (each needs its own change and test run; Expo-bundled versions follow the
Expo SDK):

| Package                                     | Current | Latest  | Used by            | Type               |
| ------------------------------------------- | ------- | ------- | ------------------ | ------------------ |
| `@eslint/js`                                | 9.39.5  | 10.0.1  | root               | dev                |
| `eslint`                                    | 9.39.5  | 10.11.0 | root, `@kadro/web` | dev                |
| `typescript`                                | 6.0.3   | 7.0.2   | every package      | dev                |
| `@types/node`                               | 22.20.4 | 26.6.4  | seven packages     | dev                |
| `msw`                                       | 2.15.0  | 3.0.1   | `@kadro/mobile`    | dev                |
| `@react-native-async-storage/async-storage` | 2.2.0   | 3.1.1   | `@kadro/mobile`    | prod (Expo-pinned) |
| `react-native-gesture-handler`              | 2.32.0  | 3.3.0   | `@kadro/mobile`    | prod (Expo-pinned) |

Minor and patch versions behind (18): `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner`
3.1144.0 → 3.1145.0 (web, worker); `react` / `react-dom` 19.2.3 → 19.3.0 and `@types/react` /
`@types/react-dom` (web, mobile); `react-native` 0.86.3 → 0.87.1, `react-native-reanimated`,
`react-native-worklets`, `react-native-screens`, `react-native-safe-area-context`,
`react-native-svg`, `@shopify/flash-list`, the three `@tanstack/*` query packages and
`test-renderer` (mobile); `lefthook` 2.1.15 → 2.1.16 (root). The React Native set is held at the
versions of Expo SDK 57 on purpose.

## 6. Reproduce

```sh
cd kadro
pnpm audit --audit-level=high
pnpm audit --prod
pnpm audit --json
pnpm why node-forge
pnpm why braces
pnpm --filter @kadro/web why braces --prod
pnpm --filter @kadro/worker why node-forge --prod
pnpm dedupe --check
pnpm outdated -r
```
