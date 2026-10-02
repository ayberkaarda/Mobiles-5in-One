import { createDbClient, type DbClient } from '@kadro/db';

import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { bootstrapJobQueues, createRoleLogins, type RoleLogins } from '../support/jobs';
import { installTestRuntime, type TestRuntime } from '../support/runtime';

export interface JobsHarness {
  readonly database: TestDatabase;
  readonly logins: RoleLogins;
  /** Domain database client connected as a `kadro_app` login. */
  readonly app: DbClient;
  readonly harness: TestRuntime;
  dispose(): Promise<void>;
}

/**
 * Migrated database with the worker's queues, one login per application role, and a test runtime
 * whose domain client and job client both run as `kadro_app`.
 */
export async function setupJobsHarness(
  prefix: string,
  env: Readonly<Record<string, string>> = {},
): Promise<JobsHarness> {
  const database = await createMigratedDatabase(prefix);
  await bootstrapJobQueues(database.url);
  const logins = await createRoleLogins(database.url);
  const app = createDbClient({ connectionString: logins.appUrl, maxConnections: 4 });
  const harness = await installTestRuntime({
    db: app.db,
    env: { DATABASE_URL: logins.appUrl, ...env },
  });
  return {
    database,
    logins,
    app,
    harness,
    dispose: async () => {
      await harness.runtime.jobClient.close();
      await app.close();
      await logins.drop();
      await database.dispose();
    },
  };
}
