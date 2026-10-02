# ADR-0043: Documented exception for the node-forge advisory GHSA-86w9-cpqp-85rv

- Status: Accepted
- Date: 2026-10-02
- Deciders: Engineering, reported to Ayberk (owner)
- Related: ADR-0001; `.github/workflows/kadro-security.yml` job `audit`

## Context

The `audit` job runs `pnpm audit --audit-level=high` from `kadro/` and failed on one high finding:
`node-forge`, GHSA-86w9-cpqp-85rv, "RSA PKCS#1 v1.5 signature verification accepts extra nested
DigestAlgorithm elements". Vulnerable versions are `<=1.4.0`; the audit reports no patched version.
The workspace resolves `node-forge@1.4.0`.

`pnpm why node-forge` shows 40 paths, all of them starting at `@kadro/mobile` and passing through
`expo` to `@expo/cli`, directly or through `@expo/code-signing-certificates`. `@expo/cli` declares
`node-forge@^1.3.3`. No path reaches `apps/web`, `apps/worker` or `packages/*`, and no workspace
`package.json` depends on `node-forge` directly. Three moderate findings are also reported; they do
not fail the gate (`--audit-level=high`) and are out of scope here.

## Decision

Ignore exactly this advisory in `kadro/pnpm-workspace.yaml`:

```yaml
auditConfig:
  ignoreGhsas:
    - GHSA-86w9-cpqp-85rv
```

The CI command is unchanged and `--audit-level=high` stays. No other advisory is ignored, and no
override or version pin is added (there is no patched release to pin to).

## Rationale

- **Scope of exposure.** The package is reachable only from the Expo command line tooling
  (`@expo/cli`), which runs on developer machines and build runners. It is not a dependency of the
  API, the worker or any shared package, so it is not part of the server runtime. Metro bundles
  application code only; `@expo/cli` is the tool that runs Metro, not code that Metro bundles.
- **Affected function.** The advisory concerns verification of RSA PKCS#1 v1.5 signatures in
  `node-forge`. The CLI uses `node-forge` for certificate handling in local code-signing helpers
  (`@expo/cli` `run/ios/codeSigning/Security.js`, and `@expo/code-signing-certificates` for creating
  and checking self-signed certificates for update code signing). In those flows the certificates
  and keys are produced or selected by the developer on their own machine, so the attacker-chosen
  signature input that the advisory requires is not part of normal use.
- **Not verified.** We did not audit whether every `@expo/cli` code path that calls
  `certificate.verify` or `publicKey.verify` is unreachable with untrusted input. The rationale
  rests on where the package runs, not on a proof that the vulnerable function is never called.
- **No fix available.** The advisory has no patched version, so the audit cannot be made green by an
  upgrade or override.

## Risk

Residual risk is a developer or build runner processing a crafted signature or certificate through
Expo CLI tooling. The direct exposure is that development or build environment. The package is not
part of any production service or of the application code we ship, but an indirect effect through
the signing or distribution artifacts that such a machine produces is not ruled out: this record
does not prove that no untrusted input can reach the vulnerable verification. Accepted by the owner
for the time the exception stands.

## Review and removal

Remove the `auditConfig` entry (and keep the CI command as is) as soon as any of these holds:

- a patched `node-forge` is released and `@expo/cli` resolves to it. `pnpm audit` alone is not proof
  while the exception is active, because it ignores this advisory: compare the resolved version
  (`pnpm why node-forge`) with the patched range and run the audit with the `auditConfig` entry
  removed;
- `@expo/cli` drops the `node-forge` dependency, for example in a newer Expo SDK.

Re-check the exception when the Expo SDK is upgraded and at the close of every delivery phase. If
`pnpm why node-forge` ever shows a path from `apps/web`, `apps/worker` or `packages/*`, the exception
no longer applies and must be withdrawn.

## Owner

Engineering owns the exception and its reviews; the owner (Ayberk) is informed in each phase report.
