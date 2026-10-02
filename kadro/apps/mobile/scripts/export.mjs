import { spawnSync } from 'node:child_process';

/**
 * Bundling check behind `pnpm build`: runs `expo export` for both platforms. The public mobile
 * environment is validated by app.config.ts; when it is not provided (CI bundle check, a fresh
 * clone) this script supplies local-only values so the bundle can still be produced. Release
 * builds run through EAS with the values of the build profile and never through this script.
 */
// eslint-disable-next-line no-restricted-properties -- build tooling forwards the process environment to Expo
const env = { ...process.env };
if (env.EXPO_PUBLIC_APP_ENV === undefined && env.EXPO_PUBLIC_API_URL === undefined) {
  env.EXPO_PUBLIC_APP_ENV = 'local';
  env.EXPO_PUBLIC_API_URL = 'http://localhost:3000';
  process.stdout.write(
    'export: using local-only public environment (bundle check, not a release)\n',
  );
}

const result = spawnSync(
  'expo',
  ['export', '--platform', 'android', '--platform', 'ios', '--output-dir', 'dist'],
  { env, stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
