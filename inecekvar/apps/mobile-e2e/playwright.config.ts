import { defineConfig, devices } from '@playwright/test';

/**
 * PWA end-to-end tests against the production build (`nx build mobile`) served by `serve.mjs`
 * with `/api/*` proxied to a running API (`IV_E2E_API`, default http://127.0.0.1:57980). The
 * API stack (Postgres, Redis, migrations, sample seed, uvicorn) is started outside, as in
 * docs/adr/0034. Ports stay on 127.0.0.1 and outside 57277-57776.
 */
const port = Number(process.env['IV_E2E_PORT'] ?? 57990);

export default defineConfig({
  testDir: './src',
  outputDir: '../../dist/.playwright/mobile-e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 360, height: 800 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: false,
    locale: 'tr-TR',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node serve.mjs',
    cwd: __dirname,
    url: `http://127.0.0.1:${port}/index.html`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      IV_E2E_PORT: String(port),
      IV_E2E_API: process.env['IV_E2E_API'] ?? 'http://127.0.0.1:57980',
    },
  },
});
