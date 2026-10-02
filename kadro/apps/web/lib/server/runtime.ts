import { setTimeout as delay } from 'node:timers/promises';

import {
  type AccessTokenService,
  createAccessTokenService,
  createCsrfService,
  type CsrfService,
} from '@kadro/auth';
import { loadWebEnv, type WebEnv } from '@kadro/config';
import { createDbClient, type Database } from '@kadro/db';

import { type ClientIpResolver, createClientIpResolver } from './client-ip';
import { createSendOnlyClient, type SendOnlyClient } from './jobs/client';
import { createJobSender, type JobSender } from './jobs/enqueue';
import { createKeyedHasher, type KeyedHasher } from './keyed-hash';
import { createLogger, type Logger } from './logging';
import { createMetrics, type Metrics } from './metrics';
import { type AuthRateLimiter, createAuthRateLimiter, SlidingWindowLimiter } from './ratelimit';

/**
 * Composition root of the API: validated configuration plus the services built from it. Route
 * handlers obtain it through {@link serverRuntime}; it is created lazily on the first request, so
 * importing a route module (for example during `next build`) never reads configuration.
 */
export interface ServerRuntime {
  readonly env: WebEnv;
  readonly db: Database;
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly accessTokens: AccessTokenService;
  readonly csrf: CsrfService;
  readonly clientIp: ClientIpResolver;
  readonly keyedHash: KeyedHasher;
  readonly limiter: SlidingWindowLimiter;
  readonly authRateLimiter: AuthRateLimiter;
  /** Send-only job queue client (started on first use) and the transactional enqueue on it. */
  readonly jobClient: SendOnlyClient;
  readonly jobs: JobSender;
  now(): Date;
  sleep(ms: number): Promise<void>;
}

export interface RuntimeOverrides {
  readonly db?: Database;
  readonly logger?: Logger;
  readonly jobClient?: SendOnlyClient;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
}

export async function createServerRuntime(
  env: WebEnv,
  overrides: RuntimeOverrides = {},
): Promise<ServerRuntime> {
  const logger = overrides.logger ?? createLogger({ level: env.LOG_LEVEL });
  const db =
    overrides.db ??
    createDbClient({
      connectionString: env.DATABASE_URL,
      applicationName: 'kadro-web',
      onClientError: (error) => {
        logger.error({ err: error }, 'database client failed');
      },
    }).db;
  const now = overrides.now ?? (() => new Date());
  const keyedHash = createKeyedHasher(env.HASH_SECRET);
  const limiter = new SlidingWindowLimiter(db, now);
  const jobClient =
    overrides.jobClient ?? createSendOnlyClient({ connectionString: env.DATABASE_URL, logger });
  return {
    env,
    db,
    logger,
    metrics: createMetrics(),
    accessTokens: await createAccessTokenService(env),
    csrf: createCsrfService(env),
    clientIp: createClientIpResolver(env),
    keyedHash,
    limiter,
    authRateLimiter: createAuthRateLimiter(limiter, env, keyedHash),
    jobClient,
    jobs: createJobSender(jobClient),
    now,
    sleep: overrides.sleep ?? ((ms) => delay(ms)),
  };
}

interface RuntimeHolder {
  kadroServerRuntime?: Promise<ServerRuntime> | undefined;
}

/** Kept on `globalThis` so development hot reloads do not open a new connection pool each time. */
const holder = globalThis as RuntimeHolder;

export function serverRuntime(): Promise<ServerRuntime> {
  let runtime = holder.kadroServerRuntime;
  if (runtime === undefined) {
    const created = createServerRuntime(loadWebEnv());
    // A failed start (invalid configuration) is retried on the next request instead of cached.
    created.catch(() => {
      if (holder.kadroServerRuntime === created) {
        holder.kadroServerRuntime = undefined;
      }
    });
    holder.kadroServerRuntime = created;
    runtime = created;
  }
  return runtime;
}

/**
 * Replaces the process-wide runtime. Used by integration tests (disposable database, captured
 * logs, controlled clock) and by hosts that build the runtime themselves.
 */
export function installServerRuntime(runtime: ServerRuntime): void {
  holder.kadroServerRuntime = Promise.resolve(runtime);
}
