import { createDbClientFromEnv } from '../client.js';
import { seedDatabase } from '../seed/index.js';

/** `pnpm --filter @kadro/db db:seed`: upserts districts and `[ÖRNEK]` sample venues. */
const client = createDbClientFromEnv({ applicationName: 'kadro-seed', maxConnections: 1 });
try {
  const result = await seedDatabase(client.db);
  process.stdout.write(
    `seeded ${String(result.districts)} districts and ${String(result.sampleVenues)} sample venues\n`,
  );
} finally {
  await client.close();
}
