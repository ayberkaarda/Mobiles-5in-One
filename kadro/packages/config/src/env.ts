import { parseEnv } from './parse.js';
import {
  type DatabaseEnv,
  databaseEnvSchema,
  type EnvSource,
  type WebEnv,
  type WorkerEnv,
  webEnvSchema,
  workerEnvSchema,
} from './schema.js';

export { EnvValidationError, type EnvIssue } from './parse.js';
export {
  APP_ENVIRONMENTS,
  CLIENT_IP_HEADERS,
  databaseEnvSchema,
  type DatabaseEnv,
  EMAIL_TRANSPORTS,
  type EmailTransportKind,
  LOG_LEVELS,
  NODE_ENVIRONMENTS,
  PUSH_TRANSPORTS,
  type PushTransportKind,
  mobilePublicEnvSchema,
  webEnvSchema,
  workerEnvSchema,
  type AppEnvironment,
  type ClientIpHeader,
  type EnvSource,
  type LogLevel,
  type MobilePublicEnv,
  type NodeEnvironment,
  type WebEnv,
  type WorkerEnv,
} from './schema.js';

export function parseWebEnv(source: EnvSource): WebEnv {
  return parseEnv('web', webEnvSchema, source);
}

export function parseWorkerEnv(source: EnvSource): WorkerEnv {
  return parseEnv('worker', workerEnvSchema, source);
}

export function parseDatabaseEnv(source: EnvSource): DatabaseEnv {
  return parseEnv('database', databaseEnvSchema, source);
}

let webEnvCache: WebEnv | undefined;
let workerEnvCache: WorkerEnv | undefined;
let databaseEnvCache: DatabaseEnv | undefined;

/** Validates `process.env` for apps/web once and returns the typed result. Throws on invalid input. */
export function loadWebEnv(): WebEnv {
  webEnvCache ??= parseWebEnv(process.env);
  return webEnvCache;
}

/** Validates `process.env` for apps/worker once and returns the typed result. Throws on invalid input. */
export function loadWorkerEnv(): WorkerEnv {
  workerEnvCache ??= parseWorkerEnv(process.env);
  return workerEnvCache;
}

/**
 * Validates only `NODE_ENV`, `APP_ENV` and `DATABASE_URL` from `process.env` once, for database
 * CLIs (migrate, seed) and `createDbClientFromEnv`. Throws `EnvValidationError` on invalid input.
 */
export function loadDatabaseEnv(): DatabaseEnv {
  databaseEnvCache ??= parseDatabaseEnv(process.env);
  return databaseEnvCache;
}
