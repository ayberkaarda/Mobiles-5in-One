/**
 * Gate for suites that need something outside the test process (a `next build` output, a local
 * browser). Locally a missing prerequisite skips the suite and says so on stderr. When `CI` is
 * `true` (GitHub Actions sets it on every job) a missing prerequisite is an error instead: a
 * suite that silently skips in CI would report green without having run.
 */

// eslint-disable-next-line no-restricted-properties -- test-run flag, not application configuration
const CI_FLAG = process.env.CI;

/** True when the run is a CI run (`CI=true` or `CI=1`). */
export const IN_CI = CI_FLAG === 'true' || CI_FLAG === '1';

/**
 * Returns `true` when the prerequisite is present. Otherwise returns `false` (the caller skips)
 * outside CI and throws under `CI=true`, which fails the test file.
 */
export function prerequisite(present: boolean, suite: string, missing: string): boolean {
  if (present) {
    return true;
  }
  if (IN_CI) {
    throw new Error(
      `${suite}: ${missing}. CI=true does not allow skipping this suite; install the prerequisite in the CI job.`,
    );
  }
  process.stderr.write(`${suite}: SKIPPED (${missing}).\n`);
  return false;
}
