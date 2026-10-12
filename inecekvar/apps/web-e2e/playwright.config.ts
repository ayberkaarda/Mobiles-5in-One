import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { TEST_CERT_SHA256, TEST_TEAM_ID } from './src/support';

const server = path.resolve(__dirname, '../../dist/apps/web/server/server.mjs');
const webCommand = `node "${server}"`;
const sharedEnv = {
  HOST: '127.0.0.1',
  IV_WEB_ALLOWED_HOSTS: 'inecekvar.app,www.inecekvar.app',
  IV_WEB_API_PUBLIC_ORIGIN: 'https://api.inecekvar.app',
  IV_WEB_TILES_ORIGIN: 'https://tiles.inecekvar.app',
  IV_WEB_CACHE_QUERY_ALLOWLIST: 'sayfa',
  IV_WEB_CACHE_TTL_SECONDS: '600',
  IV_WEB_CACHE_MAX_ENTRIES: '500',
  IV_WEB_APP_ORIGIN: 'https://app.inecekvar.app',
};

export default defineConfig({
  testDir: './src',
  outputDir: '../../dist/.playwright/web-e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:57992',
    locale: 'tr-TR',
    trace: 'retain-on-failure',
  },
  // Header checks run before browser visits so the first home request sees an empty cache.
  projects: [
    { name: 'headers', testMatch: '**/headers.spec.ts' },
    {
      name: 'raw',
      testMatch: ['**/machine-files.spec.ts', '**/routing.spec.ts'],
      dependencies: ['headers'],
    },
    {
      name: 'browser',
      testMatch: [
        '**/ssr-no-js.spec.ts',
        '**/csp-hydration.spec.ts',
        '**/pages-no-js.spec.ts',
        '**/structured-data.spec.ts',
        '**/line-map.spec.ts',
      ],
      dependencies: ['raw'],
    },
  ],
  webServer: [
    {
      command: 'node fake-api.mjs',
      cwd: __dirname,
      url: 'http://127.0.0.1:57991/ready',
      reuseExistingServer: false,
      timeout: 30_000,
      env: { IV_E2E_FAKE_API_PORT: '57991' },
    },
    {
      command: webCommand,
      cwd: __dirname,
      url: 'http://127.0.0.1:57992/healthz',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...sharedEnv,
        PORT: '57992',
        INECEKVAR_ENV: 'test',
        IV_WEB_CANONICAL_ORIGIN: 'http://127.0.0.1:57992',
        IV_WEB_API_INTERNAL_URL: 'http://127.0.0.1:57991/v1',
      },
    },
    {
      command: webCommand,
      cwd: __dirname,
      url: 'http://127.0.0.1:57993/healthz',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...sharedEnv,
        PORT: '57993',
        INECEKVAR_ENV: 'production',
        IV_WEB_CANONICAL_ORIGIN: 'https://inecekvar.app',
        IV_WEB_API_INTERNAL_URL: 'http://127.0.0.1:57991/v1',
        IV_WEB_ANDROID_CERT_SHA256: TEST_CERT_SHA256,
        IV_WEB_IOS_TEAM_ID: TEST_TEAM_ID,
      },
    },
    {
      command: webCommand,
      cwd: __dirname,
      url: 'http://127.0.0.1:57994/healthz',
      reuseExistingServer: false,
      timeout: 30_000,
      env: {
        ...sharedEnv,
        PORT: '57994',
        INECEKVAR_ENV: 'test',
        IV_WEB_CANONICAL_ORIGIN: 'http://127.0.0.1:57994',
        IV_WEB_API_INTERNAL_URL: 'http://127.0.0.1:57995/v1',
      },
    },
  ],
});
