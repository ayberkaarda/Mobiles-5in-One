// Runs the opt-in Lighthouse CI suite (tests/quality/lighthouse.test.ts) against the production
// build: `pnpm build` first, then `pnpm lighthouse`. Set CHROME_PATH when Chrome is not found.
import { spawnSync } from 'node:child_process';

const result = spawnSync(
  process.execPath,
  ['./node_modules/vitest/vitest.mjs', 'run', 'tests/quality/lighthouse.test.ts'],
  {
    stdio: 'inherit',
    // eslint-disable-next-line no-restricted-properties -- passes the environment on to the child
    env: { ...process.env, KADRO_LIGHTHOUSE: '1' },
  },
);
process.exit(result.status ?? 1);
