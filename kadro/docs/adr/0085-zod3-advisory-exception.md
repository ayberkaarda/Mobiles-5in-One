# ADR-0085: Documented exception for the zod advisory GHSA-mrhx-c7xc-m3w5 (zod 3 via the Expo CLI)

- Status: Accepted
- Date: 2026-10-25
- Deciders: Engineering, reported to Ayberk (owner)
- Related: ADR-0043, ADR-0078; `.github/workflows/kadro-security.yml` job `audit`

## Context

On 2026-10-25 the `audit` job (`pnpm audit --audit-level=high`) failed on pull requests that change
no Kadro dependency. New advisories were published for `next` (two critical, one high; patched in
16.4.1), `vite` (high, patched in 8.3.3) and `zod`: GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404, "Zod can
exhaust memory while validating oversized constrained collections", vulnerable `<4.6.6`, patched
`4.6.6`.

`next` was raised to 16.4.3, `vite` to 8.3.5 and every direct `zod` dependency to 4.6.7; the
transitive `zod` 4 copies (`eslint-plugin-react-hooks`, the `@hookform/resolvers` peer) now resolve
to 4.6.7 as well. One copy remains: `zod@3.25.76`, a dependency of `@expo/cli@57.0.32`
(`"zod": "^3.25.76"`). The 3.x line has no release after 3.25.76, so no patched version exists in the
range the Expo CLI accepts, and forcing zod 4 onto the CLI would break its 3.x API use.

## Decision

Ignore exactly this advisory in `kadro/pnpm-workspace.yaml`, next to the entries from ADR-0043 and
ADR-0078. The CI command is unchanged and `--audit-level=high` stays. No override is added.

## Rationale

- **Scope of exposure.** `@expo/cli` is the Expo development and build command line (`expo start`,
  `expo export`, prebuild). It runs on developer machines and build runners and validates its own
  configuration and manifests with zod. It is not bundled into the mobile app and is not a
  dependency of `apps/web`, `apps/worker` or any `packages/*` runtime code.
- **Attack shape.** The advisory needs an attacker to submit a very large array to a schema without a
  length limit. The CLI's inputs are repository files and Expo service responses, not untrusted user
  requests.
- **Patched where it matters.** Every zod copy that validates request data (web API, worker,
  `packages/contracts`, `packages/auth`, `packages/config`) is on 4.6.7.
- **Not verified.** We did not audit every zod schema inside the Expo CLI; the rationale rests on
  where the package runs.

## Risk

Residual risk is a developer or build runner running the Expo CLI against crafted input, which at worst
exhausts that process's memory. Accepted by the owner for the time the exception stands.

## Review and removal

Because the ignore is per advisory, it also hides a future zod 4 copy below 4.6.6. Check
`pnpm why zod -r` whenever the lockfile changes: every copy except the one under `@expo/cli` must be
`>=4.6.6`. Remove the entry when the Expo CLI moves to a patched zod (re-check on every Expo SDK
upgrade) and confirm by running the audit with the entry removed.
