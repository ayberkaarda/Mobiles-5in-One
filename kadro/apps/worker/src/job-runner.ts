import { performance } from 'node:perf_hooks';

import { JOB_PAYLOAD_SCHEMAS, type JobPayload, type JobQueue } from '@kadro/contracts';
import { EmailDeliveryError } from '@kadro/emails';
import { type JobResult, type JobWithMetadata, type PgBoss } from 'pg-boss';
import { type Logger } from 'pino';

import { type Metrics } from './metrics.js';
import { StorageError } from './storage/storage.js';
import { type QueueDefinition } from './queues.js';

/** Thrown for failures that may succeed later (network, 429, 5xx, lock timeout): retry. */
export class TransientJobError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TransientJobError';
  }
}

export interface JobContext {
  readonly jobId: string;
  readonly queue: JobQueue;
  readonly retryCount: number;
  readonly createdOn: Date;
  /** Child logger carrying `queue`, `jobId`, `idempotencyKey` and `requestId` when present. */
  readonly logger: Logger;
  /** Aborted when the job expires or the worker stops past its grace period. */
  readonly signal: AbortSignal;
}

/**
 * A handler returns a short outcome label (`sent`, `duplicate`, `skipped_stale`, ...) for a
 * completed job. Permanent failures complete with an outcome; only transient ones throw.
 */
export type JobHandler<TQueue extends JobQueue> = (
  payload: JobPayload<TQueue>,
  context: JobContext,
) => Promise<string>;

/** Error fields that are safe to log: class name, our own messages, PostgreSQL SQLSTATE. */
export function describeError(error: unknown): Record<string, string | number> {
  if (!(error instanceof Error)) {
    return { errorType: typeof error };
  }
  const fields: Record<string, string | number> = { errorType: error.name };
  if (
    error instanceof TransientJobError ||
    error instanceof EmailDeliveryError ||
    error instanceof StorageError
  ) {
    fields.errorMessage = error.message;
  }
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) {
    fields.sqlState = code;
  }
  if (error instanceof EmailDeliveryError && error.status !== undefined) {
    fields.status = error.status;
  }
  return fields;
}

const MAX_LOGGED_ISSUES = 10;

/** Validation issues reduced to path and code; offending values and unknown key names are not logged. */
function summarizeIssues(issues: readonly { path: PropertyKey[]; code: string }[]) {
  return issues.slice(0, MAX_LOGGED_ISSUES).map((issue) => ({
    path: issue.path
      .filter((segment) => typeof segment === 'number' || /^[A-Za-z]{1,40}$/.test(String(segment)))
      .join('.'),
    code: issue.code,
  }));
}

export interface RunnerDependencies {
  readonly logger: Logger;
  readonly metrics: Metrics;
  readonly pollingIntervalSeconds: number;
}

/**
 * Processes one job: strict payload validation (invalid → dead letter without retry), the
 * handler, structured outcome logging and metrics. Returns the per-job result for pg-boss.
 */
export async function runJob<TQueue extends JobQueue>(
  definition: QueueDefinition & { readonly name: TQueue },
  job: JobWithMetadata<unknown>,
  handler: JobHandler<TQueue>,
  dependencies: RunnerDependencies,
): Promise<JobResult> {
  const { logger, metrics } = dependencies;
  const queue = definition.name;
  const started = performance.now();
  const base = { queue, jobId: job.id, retryCount: job.retryCount };

  // eslint-disable-next-line security/detect-object-injection -- queue is a typed JobQueue key
  const parsed = JOB_PAYLOAD_SCHEMAS[queue].safeParse(job.data);
  if (!parsed.success) {
    logger.warn(
      { ...base, outcome: 'invalid_payload', issues: summarizeIssues(parsed.error.issues) },
      'job payload rejected',
    );
    metrics.increment('job_dead_lettered', { queue, reason: 'invalid_payload' });
    return { id: job.id, status: 'deadletter', output: { outcome: 'invalid_payload' } };
  }

  const payload = parsed.data as JobPayload<TQueue>;
  const requestId =
    'requestId' in payload && typeof payload.requestId === 'string' ? payload.requestId : undefined;
  const jobLogger = logger.child({
    ...base,
    idempotencyKey: payload.idempotencyKey,
    ...(requestId ? { requestId } : {}),
  });

  try {
    const outcome = await handler(payload, {
      jobId: job.id,
      queue,
      retryCount: job.retryCount,
      createdOn: job.createdOn,
      logger: jobLogger,
      signal: job.signal,
    });
    const durationMs = Math.round(performance.now() - started);
    jobLogger.info({ outcome, durationMs }, 'job completed');
    metrics.increment('job_completed', { queue, outcome });
    return { id: job.id, status: 'completed', output: { outcome } };
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    const exhausted = job.retryCount >= job.retryLimit;
    jobLogger.warn(
      { outcome: exhausted ? 'dead_lettered' : 'retry', durationMs, ...describeError(error) },
      'job failed',
    );
    metrics.increment('job_failed', { queue });
    if (exhausted) {
      metrics.increment('job_dead_lettered', { queue, reason: 'retries_exhausted' });
    }
    return { id: job.id, status: 'failed', output: describeError(error) };
  }
}

/** Registers the handler with `localConcurrency` workers, one job per fetch. */
export async function registerHandler<TQueue extends JobQueue>(
  boss: PgBoss,
  definition: QueueDefinition & { readonly name: TQueue },
  handler: JobHandler<TQueue>,
  dependencies: RunnerDependencies,
): Promise<string> {
  const options = {
    batchSize: 1,
    includeMetadata: true,
    perJobResults: true,
    localConcurrency: definition.localConcurrency,
    pollingIntervalSeconds: dependencies.pollingIntervalSeconds,
  } as const;
  return boss.work<unknown, unknown, typeof options>(definition.name, options, async (jobs) => {
    const results: JobResult[] = [];
    for (const job of jobs) {
      results.push(await runJob(definition, job, handler, dependencies));
    }
    return results;
  });
}
