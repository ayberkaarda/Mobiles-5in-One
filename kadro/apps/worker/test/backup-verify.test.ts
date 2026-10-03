import { randomBytes } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type BackupVerifyConfig,
  backupKeyMatcher,
  createBackupVerifyHandler,
} from '../src/backup/verify.js';
import { scheduledPayload } from '../src/boss.js';
import { HOUR_MS } from '../src/clock.js';
import { type JobContext } from '../src/job-runner.js';
import { createS3Storage } from '../src/storage/storage.js';
import {
  type FakeProvider,
  MetricsRecorder,
  MutableClock,
  TEST_BACKUP_BUCKET,
  type TestDatabase,
  type TestWorker,
  captureLogs,
  createTestDatabase,
  newId,
  startFakeProvider,
  startTestWorker,
  waitForJobState,
} from './support.js';

/**
 * ADR-0082: `backup.verify` against the in-memory S3 fake. The backups themselves are produced
 * outside the application (daily dump job on the database host); these tests prove only the
 * artifact checks, not that a real dump exists or restores.
 */

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
const NOW = new Date('2031-05-12T06:20:00.000Z');
const clock = new MutableClock(NOW);

const CONFIG: BackupVerifyConfig = {
  bucket: TEST_BACKUP_BUCKET,
  prefix: 'kadro-',
  maxAgeHours: 30,
  minBytes: 1_024,
};

beforeAll(async () => {
  database = await createTestDatabase('worker_backup_verify');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, {
    clock,
    env: {
      BACKUP_BUCKET: TEST_BACKUP_BUCKET,
      BACKUP_ACCESS_KEY_ID: 'kadro-backup-reader',
      BACKUP_SECRET_ACCESS_KEY: 'B'.repeat(32),
    },
  });
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

beforeEach(() => {
  clock.set(NOW);
  provider.s3.bucket(TEST_BACKUP_BUCKET).clear();
  provider.s3.fault = undefined;
});

function encrypted(size = 4_096): Buffer {
  const header = Buffer.from('age-encryption.org/v1\n', 'latin1');
  return Buffer.concat([header, randomBytes(size - header.length)]);
}

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * HOUR_MS);
}

function put(key: string, body: Buffer, lastModified: Date): void {
  provider.s3.putObject(TEST_BACKUP_BUCKET, key, body, lastModified);
}

function context(logger = captureLogs().logger): JobContext {
  return {
    jobId: newId(),
    queue: 'backup.verify',
    retryCount: 0,
    createdOn: clock.now(),
    singletonKey: null,
    logger,
    signal: new AbortController().signal,
  };
}

function verifier(configured = true) {
  const metrics = new MetricsRecorder();
  const handler = createBackupVerifyHandler({
    storage: configured
      ? createS3Storage({
          R2_ENDPOINT: provider.origin,
          R2_ACCESS_KEY_ID: 'kadro-backup-reader',
          R2_SECRET_ACCESS_KEY: 'B'.repeat(32),
        })
      : null,
    config: configured ? CONFIG : null,
    clock,
    metrics,
  });
  const logs = captureLogs();
  return {
    metrics,
    logs,
    run: () => handler(scheduledPayload('backup.verify'), context(logs.logger)),
  };
}

describe('backup.verify (ADR-0082)', () => {
  it('reports ok for a fresh, encrypted newest dump and ignores other keys', async () => {
    put('kadro-20310510.dump.age', encrypted(), hoursAgo(50));
    put('kadro-20310511.dump.age', encrypted(8_192), hoursAgo(26));
    put('kadro-latest.txt', Buffer.from('plain'), hoursAgo(1));
    put('kadro-20311399.dump.age', encrypted(), hoursAgo(1));
    put('other-20310512.dump.age', encrypted(), hoursAgo(1));
    const { run, metrics, logs } = verifier();

    expect(await run()).toBe('ok');
    expect(metrics.recorded).toEqual([{ name: 'backup_verified', labels: { status: 'ok' } }]);
    expect(logs.entries().at(-1)).toMatchObject({
      level: 30,
      msg: 'backup check ok',
      status: 'ok',
      object: 'kadro-20310511.dump.age',
      sizeBytes: 8_192,
      ageHours: 26,
      count: 2,
      maxAgeHours: 30,
    });
  });

  it('accepts the armored age format', async () => {
    const armored = Buffer.concat([
      Buffer.from('-----BEGIN AGE ENCRYPTED FILE-----\n', 'latin1'),
      Buffer.from(randomBytes(3_000).toString('base64'), 'latin1'),
    ]);
    put('kadro-20310512.dump.age', armored, hoursAgo(2));
    expect(await verifier().run()).toBe('ok');
  });

  it('reports stale when the newest dump is older than the threshold', async () => {
    put('kadro-20310510.dump.age', encrypted(), hoursAgo(31));
    const { run, metrics, logs } = verifier();
    expect(await run()).toBe('stale');
    expect(metrics.recorded).toEqual([
      { name: 'backup_check_failed', labels: { status: 'stale' } },
    ]);
    expect(logs.entries().at(-1)).toMatchObject({ level: 50, status: 'stale', ageHours: 31 });
  });

  it('reports failed for no dump, a tiny dump or an unencrypted dump', async () => {
    const empty = verifier();
    expect(await empty.run()).toBe('failed_no_backup');
    expect(empty.metrics.recorded).toEqual([
      { name: 'backup_check_failed', labels: { status: 'failed', reason: 'no_backup' } },
    ]);

    put('kadro-20310511.dump.age', encrypted(), hoursAgo(20));
    put('kadro-20310512.dump.age', encrypted(512), hoursAgo(2));
    expect(await verifier().run()).toBe('failed_too_small');

    // A plain custom-format dump starts with PGDMP: it must never sit in the bucket unencrypted.
    put(
      'kadro-20310512.dump.age',
      Buffer.concat([Buffer.from('PGDMP', 'latin1'), randomBytes(4_000)]),
      hoursAgo(2),
    );
    const plain = verifier();
    expect(await plain.run()).toBe('failed_not_encrypted');
    expect(plain.logs.entries().at(-1)).toMatchObject({
      level: 50,
      status: 'failed',
      reason: 'not_encrypted',
    });
  });

  it('fails a stale and unencrypted dump as failed, not stale', async () => {
    put('kadro-20310501.dump.age', Buffer.alloc(4_096, 0x41), hoursAgo(200));
    expect(await verifier().run()).toBe('failed_not_encrypted');
  });

  it('counts a storage error as failed and throws so the queue retries', async () => {
    provider.s3.fault = (operation) =>
      operation.bucket === TEST_BACKUP_BUCKET && operation.method === 'LIST' ? 500 : undefined;
    const { run, metrics } = verifier();
    await expect(run()).rejects.toMatchObject({ name: 'TransientJobError' });
    expect(metrics.recorded).toEqual([
      {
        name: 'backup_check_failed',
        labels: { status: 'failed', reason: 'storage_error', httpStatus: 500 },
      },
    ]);
  });

  it('is a logged no-op without a configured bucket', async () => {
    const { run, metrics, logs } = verifier(false);
    const operationsBefore = provider.s3.operations.length;
    expect(await run()).toBe('skipped_unconfigured');
    expect(metrics.recorded).toEqual([]);
    expect(logs.entries().at(-1)).toMatchObject({ level: 40, status: 'skipped' });
    expect(provider.s3.operations.length).toBe(operationsBefore);
  });

  it('runs through the queue and stores the outcome as the job output', async () => {
    put('kadro-20310512.dump.age', encrypted(), hoursAgo(3));
    const jobId = await worker.runtime.boss.send(
      'backup.verify',
      scheduledPayload('backup.verify'),
    );
    const job = await waitForJobState(database, 'backup.verify', jobId ?? '', ['completed']);
    expect(job.output).toEqual({ outcome: 'ok' });
    expect(worker.metrics.count('backup_verified', { status: 'ok' })).toBe(1);
    expect(worker.logs.entries().find((entry) => entry.msg === 'worker ready')?.backupVerify).toBe(
      'enabled',
    );
  });

  it('matches only <prefix>YYYYMMDD.dump.age with a real date', () => {
    const matches = backupKeyMatcher('kadro-');
    expect(matches('kadro-20310228.dump.age')).toBe(true);
    expect(matches('kadro-20310230.dump.age')).toBe(false);
    expect(matches('kadro-2031022.dump.age')).toBe(false);
    expect(matches('kadro-20310228.dump')).toBe(false);
    expect(matches('xkadro-20310228.dump.age')).toBe(false);
    expect(backupKeyMatcher('db/kadro.')('db/kadro.20310228.dump.age')).toBe(true);
    expect(backupKeyMatcher('db/kadro.')('db/kadroX20310228.dump.age')).toBe(false);
  });
});
