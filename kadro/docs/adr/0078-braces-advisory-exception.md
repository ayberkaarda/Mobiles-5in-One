# ADR-0078: Documented exception for the braces advisory GHSA-vfj7-8cjw-p6xm

- Status: Accepted
- Date: 2026-10-03
- Deciders: Engineering, reported to Ayberk (owner)
- Related: ADR-0043; `.github/workflows/kadro-security.yml` job `audit`

## Context

The `audit` job runs `pnpm audit --audit-level=high` from `kadro/`. On 2026-10-03 it started failing
on every pull request, including ones that change no dependency, because a new high advisory was
published: `braces`, GHSA-vfj7-8cjw-p6xm, "stack-exhaustion denial of service through deeply nested
patterns". Vulnerable versions are `<=3.0.3`; the audit reports no patched version. The workspace
resolves `braces@3.0.3`.

`pnpm why braces` reports 100 paths. Every path reaches `braces` through `micromatch` and starts at
one of two places: `@next/eslint-plugin-next` (through `fast-glob`, a lint-time plugin at the
workspace root) or `@kadro/mobile` through `expo`, `@expo/cli` and Metro (`metro-file-map`). None
starts at a runtime dependency of `apps/web` or `apps/worker`, and no workspace `package.json`
depends on `braces` directly.

## Decision

Ignore exactly this advisory in `kadro/pnpm-workspace.yaml`, next to the entry from ADR-0043:

```yaml
auditConfig:
  ignoreGhsas:
    - GHSA-86w9-cpqp-85rv
    - GHSA-vfj7-8cjw-p6xm
```

The CI command is unchanged and `--audit-level=high` stays. No other advisory is ignored and no
override is added (there is no patched release to pin to).

## Rationale

- **Scope of exposure.** `braces` expands glob brace patterns. Here it runs inside the linter and the
  Expo/Metro development tooling, on developer machines and build runners, with patterns taken from
  repository configuration, not from network input. It is not part of the API, the worker or any
  shipped application code.
- **Attack shape.** The advisory needs an attacker-chosen, deeply nested pattern. In these tools the
  patterns are written by the maintainers.
- **Not verified.** We did not audit every call site of `micromatch` in the tools. The rationale rests
  on where the package runs, not on a proof that no untrusted pattern can reach it.
- **No fix available.** An upgrade or override cannot make the audit green.

## Risk

Residual risk is a developer or build runner running lint or Metro on a crafted pattern, which at
worst exhausts the stack of that process. Accepted by the owner for the time the exception stands.

## Review and removal

Remove the entry as soon as a patched `braces` exists and the tools resolve to it: compare
`pnpm why braces` with the patched range and run the audit with the entry removed (the audit alone is
not proof while the exception is active). Re-check when the Expo SDK or Next.js is upgraded and at
the close of every delivery phase. If `pnpm why braces --prod` ever shows a path from `apps/web`,
`apps/worker` or `packages/*` through a runtime dependency, the exception no longer applies and must
be withdrawn.

## Owner

Engineering owns the exception and its reviews; the owner (Ayberk) is informed in each phase report.
