import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    // Starts one disposable PostgreSQL 16 + PostGIS container for the whole run; every test file
    // gets its own database and runs real pg-boss against it.
    globalSetup: ['./test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    maxWorkers: 4,
  },
});
