import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defineConfig } from '@playwright/test';

/**
 * Browser end-to-end suite of the web app (product spec §8, ADR-0068): installed Google Chrome
 * (`channel: 'chrome'`, no browser download), against the production build served by
 * `tests/e2e/global-setup.ts` with its own PostGIS container. Run `pnpm build` first, then
 * `pnpm --filter @kadro/web test:e2e`. One worker: the specs share one seeded database.
 */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  // Outside the repository: no untracked result folders next to the sources.
  outputDir: join(tmpdir(), 'kadro-web-e2e-results'),
  use: {
    channel: 'chrome',
    headless: true,
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
