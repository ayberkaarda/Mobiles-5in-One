import { type ScheduledJob } from '@kadro/contracts';

import { type Clock, HOUR_MS } from '../clock.js';
import { type JobContext, TransientJobError } from '../job-runner.js';
import { type Metrics } from '../metrics.js';
import { type ObjectStorage, StorageError, type StoredObject } from '../storage/storage.js';

/**
 * `backup.verify` (ADR-0082). The daily dump (`pg_dump -Fc`, encrypted with `age`, uploaded to the
 * backup bucket by a job on the database host, docs/release/backup-restore-drill.md) runs outside
 * this application, so the worker can only check its artifacts: it lists the bucket with a
 * read-only key, takes the newest `<prefix>YYYYMMDD.dump.age` object and checks age, size and the
 * `age` header of its first bytes. It never downloads a whole dump, decrypts or restores; that is
 * the restore drill's job. Without a configured bucket the check is skipped and logged.
 */

export const BACKUP_STATUSES = ['ok', 'stale', 'failed'] as const;
export type BackupStatus = (typeof BACKUP_STATUSES)[number];

export type BackupFailure = 'no_backup' | 'too_small' | 'not_encrypted' | 'missing';

/** First line of a binary `age` file, and the armored form. */
const AGE_HEADERS = ['age-encryption.org/v1\n', '-----BEGIN AGE ENCRYPTED FILE-----'] as const;
const HEADER_BYTES = 64;

export interface BackupVerifyConfig {
  readonly bucket: string;
  /** Object key prefix, e.g. `kadro-` for `kadro-20261001.dump.age`. */
  readonly prefix: string;
  readonly maxAgeHours: number;
  readonly minBytes: number;
}

export interface BackupCheck {
  readonly status: BackupStatus;
  readonly reason?: BackupFailure;
  /** Object name of the newest backup. */
  readonly object?: string;
  readonly sizeBytes?: number;
  readonly ageHours?: number;
  /** Matching backup objects found under the prefix. */
  readonly count: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/** `<prefix>YYYYMMDD.dump.age` with a real calendar date. */
export function backupKeyMatcher(prefix: string): (key: string) => boolean {
  // eslint-disable-next-line security/detect-non-literal-regexp -- the prefix is escaped and validated by packages/config
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d{4})(\\d{2})(\\d{2})\\.dump\\.age$`);
  return (key) => {
    const match = pattern.exec(key);
    if (match === null) {
      return false;
    }
    const [, year, month, day] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    return (
      !Number.isNaN(date.getTime()) && date.toISOString().startsWith(`${year}-${month}-${day}`)
    );
  };
}

async function listBackups(
  storage: ObjectStorage,
  config: BackupVerifyConfig,
): Promise<StoredObject[]> {
  const matches = backupKeyMatcher(config.prefix);
  const found: StoredObject[] = [];
  let token: string | undefined;
  do {
    const page = await storage.list(config.bucket, config.prefix, token);
    found.push(...page.objects.filter((object) => matches(object.key)));
    token = page.next;
  } while (token !== undefined);
  return found;
}

/** Newest by upload time, then by key (the date in the name). */
function newest(objects: readonly StoredObject[]): StoredObject | undefined {
  return [...objects].sort(
    (a, b) =>
      b.lastModified.getTime() - a.lastModified.getTime() ||
      (a.key < b.key ? 1 : a.key > b.key ? -1 : 0),
  )[0];
}

/**
 * Checks the newest backup. `failed` outranks `stale`: a too small, unencrypted or vanished object
 * is a failure whatever its age. Storage errors propagate (the job retries).
 */
export async function checkBackups(
  storage: ObjectStorage,
  config: BackupVerifyConfig,
  now: Date,
  signal?: AbortSignal,
): Promise<BackupCheck> {
  const backups = await listBackups(storage, config);
  const latest = newest(backups);
  if (latest === undefined) {
    return { status: 'failed', reason: 'no_backup', count: 0 };
  }
  const ageHours = Math.max(0, (now.getTime() - latest.lastModified.getTime()) / HOUR_MS);
  const base = {
    object: latest.key,
    sizeBytes: latest.size,
    ageHours: Math.round(ageHours * 10) / 10,
    count: backups.length,
  };
  if (latest.size < config.minBytes) {
    return { status: 'failed', reason: 'too_small', ...base };
  }
  const head = await storage.read(config.bucket, latest.key, HEADER_BYTES, signal);
  if (head === null) {
    return { status: 'failed', reason: 'missing', ...base };
  }
  const text = head.toString('latin1');
  if (!AGE_HEADERS.some((header) => text.startsWith(header))) {
    return { status: 'failed', reason: 'not_encrypted', ...base };
  }
  if (ageHours > config.maxAgeHours) {
    return { status: 'stale', ...base };
  }
  return { status: 'ok', ...base };
}

export interface BackupVerifyDependencies {
  /** `null` when `BACKUP_BUCKET` is not configured. */
  readonly storage: ObjectStorage | null;
  readonly config: BackupVerifyConfig | null;
  readonly clock: Clock;
  readonly metrics: Metrics;
}

/**
 * Handler of `backup.verify`. Outcomes: `ok`, `stale`, `failed_<reason>`, `skipped_unconfigured`;
 * the outcome is stored as the job's output. `ok` logs at `info` with `backup_verified`; `stale` and
 * `failed` log at `error` with `backup_check_failed{status,reason}`. A storage error is counted as
 * `failed` (`storage_error`) and retried by the queue.
 */
export function createBackupVerifyHandler(dependencies: BackupVerifyDependencies) {
  const { storage, config, clock, metrics } = dependencies;

  return async (_job: ScheduledJob, context: JobContext): Promise<string> => {
    if (storage === null || config === null) {
      context.logger.warn(
        { status: 'skipped' },
        'backup check skipped: no backup bucket configured',
      );
      return 'skipped_unconfigured';
    }
    let check: BackupCheck;
    try {
      check = await checkBackups(storage, config, clock.now(), context.signal);
    } catch (error) {
      const status = error instanceof StorageError ? error.status : undefined;
      metrics.increment('backup_check_failed', {
        status: 'failed',
        reason: 'storage_error',
        ...(status === undefined ? {} : { httpStatus: status }),
      });
      context.logger.error(
        { status: 'failed', reason: 'storage_error', bucket: config.bucket },
        'backup check failed',
      );
      throw new TransientJobError('backup storage unreachable', { cause: error });
    }

    const fields = { ...check, bucket: config.bucket, maxAgeHours: config.maxAgeHours };
    if (check.status === 'ok') {
      metrics.increment('backup_verified', { status: 'ok' });
      context.logger.info(fields, 'backup check ok');
      return 'ok';
    }
    metrics.increment('backup_check_failed', {
      status: check.status,
      ...(check.reason === undefined ? {} : { reason: check.reason }),
    });
    context.logger.error(fields, check.status === 'stale' ? 'backup stale' : 'backup check failed');
    return check.status === 'stale' ? 'stale' : `failed_${check.reason ?? 'unknown'}`;
  };
}
