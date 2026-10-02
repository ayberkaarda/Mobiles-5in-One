import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Environment handed to `expo export`. Strict by default: nothing is added, so a missing or
 * invalid public environment (shell or `.env` files) fails in app.config.ts. Only with
 * `--bundle-check` (CI bundling check, `pnpm build`) are local-only values supplied for variables
 * the shell leaves unset; release builds run through EAS and never use this flag.
 */
export function resolveExportEnv(source, bundleCheck) {
  const env = { ...source };
  if (bundleCheck) {
    env.EXPO_PUBLIC_APP_ENV ??= 'local';
    env.EXPO_PUBLIC_API_URL ??= 'http://localhost:3000';
  }
  return env;
}

function main() {
  const bundleCheck = process.argv.includes('--bundle-check');
  // eslint-disable-next-line no-restricted-properties -- build tooling forwards the process environment to Expo
  const env = resolveExportEnv(process.env, bundleCheck);
  if (bundleCheck) {
    process.stdout.write('export: bundle check (local-only defaults for unset public variables)\n');
  }
  const result = spawnSync(
    'expo',
    ['export', '--platform', 'android', '--platform', 'ios', '--output-dir', 'dist'],
    { env, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  process.exit(result.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
