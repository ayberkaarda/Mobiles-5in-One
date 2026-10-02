import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    // Browser end-to-end specs (Playwright) are not Vitest suites.
    exclude: ['tests/e2e/**', 'node_modules/**'],
    environment: 'node',
    // Starts one disposable PostgreSQL 16 + PostGIS container for the run (Docker CLI); each
    // DB-backed test file creates and drops its own database inside it.
    globalSetup: ['./tests/support/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
