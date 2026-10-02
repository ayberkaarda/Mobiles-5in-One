import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDbClientFromEnv } from '../src/client.js';
import { migrateFromEnv } from '../src/migrate.js';
import { venues } from '../src/schema/index.js';
import { seedDatabase } from '../src/seed/index.js';
import { createEmptyDatabase } from './support.js';

/** Keys of the worker and web configurations that the database tools must not depend on. */
const APP_ONLY_KEYS = [
  'BUILD_SHA',
  'LOG_LEVEL',
  'WEB_ORIGIN',
  'CORS_ALLOWED_ORIGINS',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'EMAIL_TRANSPORT',
  'EMAIL_FROM',
  'RESEND_API_KEY',
  'PUSH_TRANSPORT',
  'EXPO_ACCESS_TOKEN',
  'PUSH_HOURLY_CAP',
];

let drop: () => Promise<void>;

beforeAll(async () => {
  const database = await createEmptyDatabase('kadro_dbenv');
  drop = database.drop;
  // Database-only environment, exactly what `db:migrate` and `db:seed` receive in a deploy step.
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('APP_ENV', 'local');
  vi.stubEnv('DATABASE_URL', database.url);
  for (const key of APP_ONLY_KEYS) {
    vi.stubEnv(key, undefined);
  }
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await drop();
});

describe('database tools with a database-only environment', () => {
  it('migrates and seeds without any worker, web, email or push settings', async () => {
    await migrateFromEnv();
    await migrateFromEnv();

    const client = createDbClientFromEnv({ maxConnections: 1 });
    try {
      const result = await seedDatabase(client.db);
      expect(result.sampleVenues).toBeGreaterThan(0);
      const [row] = await client.db
        .select({ value: count() })
        .from(venues)
        .where(eq(venues.isSample, true));
      expect(row?.value).toBe(result.sampleVenues);
    } finally {
      await client.close();
    }
  });
});
