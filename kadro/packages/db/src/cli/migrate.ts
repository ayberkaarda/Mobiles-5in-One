import { migrateFromEnv } from '../migrate.js';

/** `pnpm --filter @kadro/db db:migrate`: applies committed migrations to DATABASE_URL. */
await migrateFromEnv();
process.stdout.write('migrations applied\n');
