import { type WorkerEnv } from '@kadro/config';
import { type JobQueue } from '@kadro/contracts';
import { type Database, type DbClient, createDbClient } from '@kadro/db';
import { type EmailFetch } from '@kadro/emails';
import { sql } from 'drizzle-orm';
import { type PgBoss } from 'pg-boss';
import { type Logger } from 'pino';

import { createHardDeleteHandler } from './accounts/hard-delete.js';
import { bootstrapQueues, createBoss, withSessionRole } from './boss.js';
import { type Clock, systemClock } from './clock.js';
import { createEmailHandler } from './email/handler.js';
import { createEmailTransport } from './email/transport.js';
import { HealthReporter, defaultHealthFile } from './health.js';
import { type JobHandler, describeError, registerHandler } from './job-runner.js';
import { createSweepHandler } from './maintenance/sweep.js';
import { type Metrics, createLogMetrics } from './metrics.js';
import { createOpenCallExpireHandler } from './opencalls/expire.js';
import { createPushReceiptsHandler, createPushSendHandler } from './push/handler.js';
import { type PushFetch, type PushTransport, createPushTransport } from './push/transport.js';
import {
  type QueueDefinition,
  type QueueOverrides,
  WORKER_DB_ROLE,
  resolveQueueDefinitions,
} from './queues.js';
import { createMatchReminderHandler } from './reminders/handler.js';
import { type ObjectStorage, createS3Storage } from './storage/storage.js';
import { createUploadProcessHandler } from './uploads/process.js';

export type WorkerRuntimeEnv = Pick<
  WorkerEnv,
  | 'APP_ENV'
  | 'DATABASE_URL'
  | 'WEB_ORIGIN'
  | 'EMAIL_TRANSPORT'
  | 'RESEND_API_KEY'
  | 'EMAIL_FROM'
  | 'PUSH_TRANSPORT'
  | 'EXPO_ACCESS_TOKEN'
  | 'PUSH_HOURLY_CAP'
  | 'R2_ENDPOINT'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'R2_INCOMING_BUCKET'
  | 'R2_MEDIA_BUCKET'
>;

export interface WorkerRuntimeOptions {
  readonly env: WorkerRuntimeEnv;
  readonly logger: Logger;
  readonly fetch: EmailFetch & PushFetch;
  readonly clock?: Clock;
  readonly metrics?: Metrics;
  /** Run the cron loop in this process. Default true. */
  readonly schedule?: boolean;
  readonly pollingIntervalSeconds?: number;
  /** Graceful stop deadline for active handlers (ADR-0028: 30 s). */
  readonly shutdownTimeoutMs?: number;
  readonly healthFile?: string;
  readonly healthIntervalMs?: number;
  readonly queueOverrides?: QueueOverrides;
  /** Provider origins; tests point them at local servers. */
  readonly resendApiOrigin?: string;
  readonly expoApiOrigin?: string;
  /** Replaces the configured push transport (tests). */
  readonly pushTransport?: PushTransport;
  /** Replaces the S3 client built from the R2 settings (tests). */
  readonly storage?: ObjectStorage;
}

export interface WorkerRuntime {
  readonly boss: PgBoss;
  readonly db: Database;
  readonly health: HealthReporter;
  readonly definitions: readonly QueueDefinition[];
  /** Stops fetching, waits for active handlers up to the deadline, then closes the pool. */
  stop(): Promise<void>;
}

export const SHUTDOWN_TIMEOUT_MS = 30_000;
const DEFAULT_POLLING_SECONDS = 2;
const HEALTH_INTERVAL_MS = 30_000;

/** Starts pg-boss as `kadro_worker`, creates the queues and registers every active handler. */
export async function startWorker(options: WorkerRuntimeOptions): Promise<WorkerRuntime> {
  const { env, logger } = options;
  const clock = options.clock ?? systemClock;
  const metrics = options.metrics ?? createLogMetrics(logger);
  const health = new HealthReporter(options.healthFile ?? defaultHealthFile());
  await health.set('starting');

  const dbClient: DbClient = createDbClient({
    connectionString: withSessionRole(env.DATABASE_URL, WORKER_DB_ROLE),
    applicationName: 'kadro-worker',
    maxConnections: 10,
    onIdleClientError: (error) => {
      logger.error(describeError(error), 'idle database connection failed');
    },
  });
  const { db } = dbClient;
  const boss = createBoss({
    connectionString: env.DATABASE_URL,
    schedule: options.schedule ?? true,
  });
  boss.on('error', (error) => {
    logger.error(describeError(error), 'pg-boss error');
  });
  boss.on('warning', (warning) => {
    logger.warn({ warning: warning.message }, 'pg-boss warning');
  });

  const definitions = resolveQueueDefinitions(options.queueOverrides);
  try {
    await boss.start();
    await bootstrapQueues(boss, db, definitions);
  } catch (error) {
    await boss.stop({ graceful: false }).catch(() => undefined);
    await dbClient.close().catch(() => undefined);
    await health.set('unhealthy');
    throw error;
  }

  const emailTransport = createEmailTransport(env, {
    logger,
    fetch: options.fetch,
    ...(options.resendApiOrigin ? { apiOrigin: options.resendApiOrigin } : {}),
  });
  const pushTransport =
    options.pushTransport ??
    createPushTransport(env, {
      logger,
      fetch: options.fetch,
      ...(options.expoApiOrigin ? { apiOrigin: options.expoApiOrigin } : {}),
    });

  const storage = options.storage ?? createS3Storage(env);
  const buckets = { incoming: env.R2_INCOMING_BUCKET, media: env.R2_MEDIA_BUCKET };

  const handlers: { [TQueue in JobQueue]?: JobHandler<TQueue> } = {
    'email.send': createEmailHandler({
      db,
      transport: emailTransport,
      webOrigin: env.WEB_ORIGIN,
      clock,
      metrics,
    }),
    'push.send': createPushSendHandler({
      db,
      boss,
      transport: pushTransport,
      clock,
      metrics,
      hourlyCap: env.PUSH_HOURLY_CAP,
    }),
    'push.receipts': createPushReceiptsHandler({ db, transport: pushTransport, metrics }),
    'match.reminder': createMatchReminderHandler({ db, boss, clock }),
    'opencall.expire': createOpenCallExpireHandler({ db, boss, clock }),
    'maintenance.sweep': createSweepHandler({ db, boss, clock, storage, buckets }),
    'upload.process': createUploadProcessHandler({ db, storage, buckets, clock }),
    'account.hard_delete': createHardDeleteHandler({
      db,
      boss,
      storage,
      buckets,
      emailTransport,
      webOrigin: env.WEB_ORIGIN,
      clock,
      metrics,
    }),
  };

  const runner = {
    logger,
    metrics,
    pollingIntervalSeconds: options.pollingIntervalSeconds ?? DEFAULT_POLLING_SECONDS,
  };
  for (const definition of definitions) {
    const handler = handlers[definition.name] as JobHandler<JobQueue> | undefined;
    if (definition.stage === 'active' && handler !== undefined) {
      await registerHandler(boss, definition, handler, runner);
    }
  }

  await health.set('ready');
  logger.info(
    {
      queues: definitions.map((definition) => definition.name),
      emailTransport: emailTransport.name,
      pushTransport: pushTransport.name,
    },
    'worker ready',
  );

  const probe = setInterval(() => {
    db.execute(sql`select 1`)
      .then(async () => {
        if (health.status === 'ready' || health.status === 'unhealthy') {
          await health.set('ready');
        }
      })
      .catch(async (error: unknown) => {
        logger.error(describeError(error), 'health probe failed');
        await health.set('unhealthy').catch(() => undefined);
      });
  }, options.healthIntervalMs ?? HEALTH_INTERVAL_MS);
  probe.unref();

  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      clearInterval(probe);
      await health.set('stopping');
      try {
        await boss.stop({
          graceful: true,
          timeout: options.shutdownTimeoutMs ?? SHUTDOWN_TIMEOUT_MS,
        });
      } finally {
        await dbClient.close();
        await health.clear();
      }
    })();
    return stopping;
  };

  return { boss, db, health, definitions, stop };
}
