import { type UploadContentType, newId, teams, uploads, users } from '@kadro/db';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { scheduledPayload } from '../src/boss.js';
import { DAY_MS, HOUR_MS } from '../src/clock.js';
import { enqueue } from '../src/enqueue.js';
import { detectImageType } from '../src/uploads/image.js';
import { incomingKey, mediaKey } from '../src/uploads/keys.js';
import { MEDIA_CACHE_CONTROL } from '../src/uploads/process.js';
import {
  type FakeProvider,
  Fixtures,
  TEST_INCOMING_BUCKET,
  TEST_MEDIA_BUCKET,
  type TestDatabase,
  type TestWorker,
  createTestDatabase,
  jobsIn,
  startFakeProvider,
  startTestWorker,
  waitForJobState,
} from './support.js';

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;

beforeAll(async () => {
  database = await createTestDatabase('worker_uploads');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, {
    queueOverrides: { 'upload.process': { retryLimit: 2, retryDelaySeconds: 1 } },
  });
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

beforeEach(() => {
  provider.s3.fault = undefined;
  provider.s3.before = undefined;
  provider.s3.readOverride = undefined;
});

// ---------------------------------------------------------------------------
// Image fixtures, generated at run time
// ---------------------------------------------------------------------------

async function jpegWithExif(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 20, g: 120, b: 60 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: 'Kadro test fixture', Artist: 'Fixture camera owner' } })
    .toBuffer();
}

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 240, g: 107, b: 26 } } })
    .png()
    .toBuffer();
}

async function webp(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 14, g: 26, b: 20 } } })
    .webp()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Upload staging
// ---------------------------------------------------------------------------

interface Staged {
  readonly id: string;
  readonly userId: string;
  readonly teamId: string | null;
  readonly incoming: string;
  readonly media: string;
}

async function stage(input: {
  userId: string;
  bytes: Buffer;
  contentType: UploadContentType;
  teamId?: string;
  contentLength?: number;
  store?: boolean;
  status?: 'pending' | 'processing';
  createdAt?: Date;
}): Promise<Staged> {
  const id = newId();
  const kind = input.teamId ? 'badge' : 'avatar';
  const key = kind === 'avatar' ? `avatars/${input.userId}/${id}` : `badges/${input.teamId}/${id}`;
  await database.admin.db.insert(uploads).values({
    id,
    userId: input.userId,
    kind,
    teamId: input.teamId ?? null,
    contentType: input.contentType,
    contentLength: input.contentLength ?? input.bytes.length,
    status: input.status ?? 'processing',
    key,
    ...(input.createdAt ? { createdAt: input.createdAt } : {}),
  });
  const upload = { id, kind, userId: input.userId, teamId: input.teamId ?? null, key } as const;
  const incoming = incomingKey(upload);
  if (input.store ?? true) {
    provider.s3.putObject(TEST_INCOMING_BUCKET, incoming, input.bytes);
  }
  return {
    id,
    userId: input.userId,
    teamId: input.teamId ?? null,
    incoming,
    media: mediaKey(upload),
  };
}

async function runUpload(staged: Staged) {
  const jobId = await enqueue(worker.runtime.boss, 'upload.process', {
    uploadId: staged.id,
    idempotencyKey: `upload:${staged.id}:${newId()}`,
  });
  return waitForJobState(database, 'upload.process', jobId ?? '', ['completed'], 30_000);
}

/** Makes a published object look one day old, past the orphan grace period. */
function age(key: string): void {
  const object = provider.s3.object(TEST_MEDIA_BUCKET, key);
  if (object === undefined) {
    throw new Error('object to age is missing');
  }
  object.lastModified = new Date(Date.now() - DAY_MS);
}

async function uploadRow(id: string) {
  const [row] = await database.admin.db.select().from(uploads).where(eq(uploads.id, id));
  return row;
}

async function avatarKeyOf(userId: string): Promise<string | null | undefined> {
  const [row] = await database.admin.db
    .select({ key: users.avatarKey })
    .from(users)
    .where(eq(users.id, userId));
  return row?.key;
}

describe('magic bytes', () => {
  it('recognises JPEG, PNG and WebP and nothing else', async () => {
    expect(detectImageType(await jpegWithExif(8, 8))).toBe('image/jpeg');
    expect(detectImageType(await png(8, 8))).toBe('image/png');
    expect(detectImageType(await webp(8, 8))).toBe('image/webp');
    expect(detectImageType(Buffer.from('GIF89a\u0001\u0000\u0001\u0000', 'latin1'))).toBeNull();
    expect(detectImageType(Buffer.concat([Buffer.from('MZ'), Buffer.alloc(64)]))).toBeNull();
    expect(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImageType(Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVE', 'latin1'))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('upload.process (ADR-0030)', () => {
  it('re-encodes an avatar to WebP within 1024 px, strips EXIF, publishes and applies it', async () => {
    const user = await fixtures.user();
    const source = await jpegWithExif(2000, 1500);
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const staged = await stage({ userId: user.id, bytes: source, contentType: 'image/jpeg' });

    const job = await runUpload(staged);
    expect(job.output).toEqual({ outcome: 'ready' });
    expect((await uploadRow(staged.id))?.status).toBe('ready');
    expect(await avatarKeyOf(user.id)).toBe(staged.media);
    expect(staged.media).toBe(`avatars/${user.id}/${staged.id}.webp`);

    const published = provider.s3.object(TEST_MEDIA_BUCKET, staged.media);
    expect(published?.contentType).toBe('image/webp');
    expect(published?.cacheControl).toBe(MEDIA_CACHE_CONTROL);
    const metadata = await sharp(published?.body).metadata();
    expect(metadata.format).toBe('webp');
    expect([metadata.width, metadata.height]).toEqual([1024, 768]);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(published?.body.includes(Buffer.from('Fixture camera owner'))).toBe(false);
    // Raw bytes never stay behind.
    expect(provider.s3.object(TEST_INCOMING_BUCKET, staged.incoming)).toBeUndefined();
  });

  it('accepts PNG and WebP and never enlarges a small image', async () => {
    const user = await fixtures.user();
    const small = await stage({
      userId: user.id,
      bytes: await png(300, 200),
      contentType: 'image/png',
    });
    expect((await runUpload(small)).output).toEqual({ outcome: 'ready' });
    const smallMeta = await sharp(
      provider.s3.object(TEST_MEDIA_BUCKET, small.media)?.body,
    ).metadata();
    expect([smallMeta.width, smallMeta.height]).toEqual([300, 200]);

    const wide = await stage({
      userId: user.id,
      bytes: await webp(1600, 400),
      contentType: 'image/webp',
    });
    expect((await runUpload(wide)).output).toEqual({ outcome: 'ready' });
    const wideMeta = await sharp(
      provider.s3.object(TEST_MEDIA_BUCKET, wide.media)?.body,
    ).metadata();
    expect([wideMeta.width, wideMeta.height]).toEqual([1024, 256]);

    // The second avatar replaced the first: old row deleted, old object gone.
    expect((await uploadRow(small.id))?.status).toBe('deleted');
    expect(provider.s3.object(TEST_MEDIA_BUCKET, small.media)).toBeUndefined();
    expect(await avatarKeyOf(user.id)).toBe(wide.media);
  });

  it('rejects what is not an image, a type mismatch, size mismatches and missing objects', async () => {
    const user = await fixtures.user();
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(2_000, 0x41)]);
    const gif = Buffer.concat([Buffer.from('GIF89a', 'latin1'), Buffer.alloc(500, 0x41)]);
    const pngBytes = await png(64, 64);
    const cases: [Staged, string][] = [
      [
        await stage({ userId: user.id, bytes: exe, contentType: 'image/jpeg' }),
        'rejected_not_an_image',
      ],
      [
        await stage({ userId: user.id, bytes: gif, contentType: 'image/png' }),
        'rejected_not_an_image',
      ],
      [
        await stage({ userId: user.id, bytes: pngBytes, contentType: 'image/jpeg' }),
        'rejected_type_mismatch',
      ],
      [
        await stage({
          userId: user.id,
          bytes: pngBytes,
          contentType: 'image/png',
          contentLength: pngBytes.length + 10,
        }),
        'rejected_size_mismatch',
      ],
      [
        await stage({ userId: user.id, bytes: pngBytes, contentType: 'image/png', store: false }),
        'rejected_missing',
      ],
    ];
    for (const [staged, outcome] of cases) {
      const job = await runUpload(staged);
      expect(job.output, outcome).toEqual({ outcome });
      expect(job.retryCount).toBe(0);
      const row = await uploadRow(staged.id);
      expect(row?.status).toBe('rejected');
      expect(`rejected_${row?.rejectReason}`).toBe(outcome);
      expect(provider.s3.object(TEST_INCOMING_BUCKET, staged.incoming)).toBeUndefined();
      expect(provider.s3.object(TEST_MEDIA_BUCKET, staged.media)).toBeUndefined();
    }
    expect(await avatarKeyOf(user.id)).toBeNull();
    expect(await jobsIn(database, 'upload.process.dead')).toHaveLength(0);
  });

  it('rejects a pixel bomb and a corrupt image without dead-lettering the job', async () => {
    const user = await fixtures.user();
    const bomb = await png(6_000, 5_000);
    expect(bomb.length).toBeLessThan(2_097_152);
    const bombJob = await runUpload(
      await stage({ userId: user.id, bytes: bomb, contentType: 'image/png' }),
    );
    expect(bombJob.output).toEqual({ outcome: 'rejected_too_many_pixels' });

    const truncated = (await jpegWithExif(400, 300)).subarray(0, 400);
    const corrupt = await runUpload(
      await stage({ userId: user.id, bytes: truncated, contentType: 'image/jpeg' }),
    );
    expect(corrupt.output).toEqual({ outcome: 'rejected_decode_failed' });
    expect(await jobsIn(database, 'upload.process.dead')).toHaveLength(0);
  });

  it('applies a badge only for captain or co-captain and replaces the previous badge', async () => {
    const captain = await fixtures.user();
    const coCaptain = await fixtures.user();
    const player = await fixtures.user();
    const teamId = await fixtures.team(captain.id);
    await fixtures.member(teamId, coCaptain.id, 'co_captain');
    await fixtures.member(teamId, player.id, 'player');

    const first = await stage({
      userId: captain.id,
      teamId,
      bytes: await png(500, 500),
      contentType: 'image/png',
    });
    expect((await runUpload(first)).output).toEqual({ outcome: 'ready' });
    const second = await stage({
      userId: coCaptain.id,
      teamId,
      bytes: await png(400, 400),
      contentType: 'image/png',
    });
    expect((await runUpload(second)).output).toEqual({ outcome: 'ready' });
    const denied = await stage({
      userId: player.id,
      teamId,
      bytes: await png(400, 400),
      contentType: 'image/png',
    });
    expect((await runUpload(denied)).output).toEqual({ outcome: 'rejected_not_allowed' });

    const [team] = await database.admin.db.select().from(teams).where(eq(teams.id, teamId));
    expect(team?.badgeKey).toBe(second.media);
    expect(second.media).toBe(`badges/${teamId}/${second.id}.webp`);
    expect((await uploadRow(first.id))?.status).toBe('deleted');
    expect(provider.s3.keys(TEST_MEDIA_BUCKET, `badges/${teamId}/`)).toEqual([second.media]);
  });

  it('rejects an avatar of an account deactivated before processing finished', async () => {
    const user = await fixtures.user({ deactivatedAt: new Date() });
    const job = await runUpload(
      await stage({ userId: user.id, bytes: await png(50, 50), contentType: 'image/png' }),
    );
    expect(job.output).toEqual({ outcome: 'rejected_not_allowed' });
    expect(await avatarKeyOf(user.id)).toBeNull();
  });

  it('applies one effect when the same upload is processed twice', async () => {
    const user = await fixtures.user();
    const staged = await stage({
      userId: user.id,
      bytes: await png(120, 90),
      contentType: 'image/png',
    });
    expect((await runUpload(staged)).output).toEqual({ outcome: 'ready' });
    const putsBefore = provider.s3.operations.filter((op) => op.method === 'PUT').length;
    expect((await runUpload(staged)).output).toEqual({ outcome: 'skipped_status' });
    expect(provider.s3.operations.filter((op) => op.method === 'PUT').length).toBe(putsBefore);
    expect(provider.s3.keys(TEST_MEDIA_BUCKET, `avatars/${user.id}/`)).toEqual([staged.media]);
    expect((await uploadRow(staged.id))?.status).toBe('ready');
  });

  it('keeps the published image of the winning run when two runs of one upload overlap', async () => {
    const user = await fixtures.user();
    const staged = await stage({
      userId: user.id,
      bytes: await png(140, 100),
      contentType: 'image/png',
    });
    // The first PUT of the target stalls, so the second run publishes and commits first; the
    // stalled run then finds the upload `ready`.
    let puts = 0;
    provider.s3.before = async (operation) => {
      if (operation.method === 'PUT' && operation.key === staged.media) {
        puts += 1;
        if (puts === 1) {
          await new Promise((resolve) => setTimeout(resolve, 2_500));
        }
      }
    };
    const ids = await Promise.all(
      [1, 2].map(() =>
        enqueue(worker.runtime.boss, 'upload.process', {
          uploadId: staged.id,
          idempotencyKey: `upload:${staged.id}:${newId()}`,
        }),
      ),
    );
    const outcomes = [];
    for (const id of ids) {
      const job = await waitForJobState(
        database,
        'upload.process',
        id ?? '',
        ['completed'],
        30_000,
      );
      outcomes.push((job.output as { outcome: string }).outcome);
    }
    expect(puts).toBe(2);
    expect(outcomes.sort()).toEqual(['ready', 'skipped_status']);
    expect((await uploadRow(staged.id))?.status).toBe('ready');
    expect(await avatarKeyOf(user.id)).toBe(staged.media);
    expect(provider.s3.object(TEST_MEDIA_BUCKET, staged.media)).toBeDefined();
  });

  it('rejects bytes whose length differs from the size HEAD reported', async () => {
    const user = await fixtures.user();
    const bytes = await png(64, 48);
    const staged = await stage({ userId: user.id, bytes, contentType: 'image/png' });
    provider.s3.readOverride = (operation, body) =>
      operation.key === staged.incoming ? body.subarray(0, body.length - 7) : body;
    const job = await runUpload(staged);
    expect(job.output).toEqual({ outcome: 'rejected_size_mismatch' });
    expect(provider.s3.object(TEST_MEDIA_BUCKET, staged.media)).toBeUndefined();
  });

  it('retries a transient storage failure and then publishes', async () => {
    const user = await fixtures.user();
    const staged = await stage({
      userId: user.id,
      bytes: await png(80, 80),
      contentType: 'image/png',
    });
    let failures = 0;
    provider.s3.fault = (operation) => {
      if (operation.method === 'HEAD' && operation.key === staged.incoming && failures < 2) {
        failures += 1;
        return 503;
      }
      return undefined;
    };
    const job = await runUpload(staged);
    expect(job.retryCount).toBeGreaterThanOrEqual(1);
    expect(job.output).toEqual({ outcome: 'ready' });
    expect(worker.metrics.count('job_failed', { queue: 'upload.process' })).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe('maintenance.sweep for uploads (ADR-0030)', () => {
  it('closes uploads stuck in processing without a live job and removes their objects', async () => {
    const user = await fixtures.user();
    const old = new Date(Date.now() - 2 * HOUR_MS);
    const stuck = await stage({
      userId: user.id,
      bytes: await png(20, 20),
      contentType: 'image/png',
    });
    await database.admin.db.update(uploads).set({ updatedAt: old }).where(eq(uploads.id, stuck.id));
    provider.s3.putObject(TEST_MEDIA_BUCKET, stuck.media, Buffer.from('webp'), old);

    // Same age, but its job is still queued: left alone.
    const waiting = await stage({
      userId: user.id,
      bytes: await png(20, 20),
      contentType: 'image/png',
    });
    await database.admin.db
      .update(uploads)
      .set({ updatedAt: old })
      .where(eq(uploads.id, waiting.id));
    await enqueue(
      worker.runtime.boss,
      'upload.process',
      { uploadId: waiting.id, idempotencyKey: `upload:${waiting.id}` },
      { startAfter: new Date(Date.now() + DAY_MS) },
    );
    // Recent processing upload: left alone.
    const recent = await stage({
      userId: user.id,
      bytes: await png(20, 20),
      contentType: 'image/png',
    });

    const jobId = await worker.runtime.boss.send(
      'maintenance.sweep',
      scheduledPayload('maintenance.sweep'),
    );
    await waitForJobState(database, 'maintenance.sweep', jobId ?? '', ['completed']);

    expect(await uploadRow(stuck.id)).toMatchObject({
      status: 'rejected',
      rejectReason: 'expired',
    });
    expect(provider.s3.object(TEST_INCOMING_BUCKET, stuck.incoming)).toBeUndefined();
    expect(provider.s3.object(TEST_MEDIA_BUCKET, stuck.media)).toBeUndefined();
    expect((await uploadRow(waiting.id))?.status).toBe('processing');
    expect(provider.s3.object(TEST_INCOMING_BUCKET, waiting.incoming)).toBeDefined();
    expect((await uploadRow(recent.id))?.status).toBe('processing');
    expect(provider.s3.object(TEST_INCOMING_BUCKET, recent.incoming)).toBeDefined();
  });

  it('expires stale pending uploads and removes orphan media objects only', async () => {
    const user = await fixtures.user();
    const old = new Date(Date.now() - 2 * HOUR_MS);
    const stale = await stage({
      userId: user.id,
      bytes: await png(10, 10),
      contentType: 'image/png',
      status: 'pending',
      createdAt: old,
    });
    const fresh = await stage({
      userId: user.id,
      bytes: await png(10, 10),
      contentType: 'image/png',
      status: 'pending',
    });

    const kept = await stage({
      userId: user.id,
      bytes: await png(32, 32),
      contentType: 'image/png',
    });
    expect((await runUpload(kept)).output).toEqual({ outcome: 'ready' });
    age(kept.media);

    // Avatar removed through PATCH me: the ready upload is no longer referenced.
    const removed = await stage({
      userId: (await fixtures.user()).id,
      bytes: await png(32, 32),
      contentType: 'image/png',
    });
    expect((await runUpload(removed)).output).toEqual({ outcome: 'ready' });
    await database.admin.db
      .update(users)
      .set({ avatarKey: null })
      .where(eq(users.id, removed.userId));
    age(removed.media);

    const strayOld = `badges/${newId()}/${newId()}.webp`;
    const strayYoung = `badges/${newId()}/${newId()}.webp`;
    provider.s3.putObject(
      TEST_MEDIA_BUCKET,
      strayOld,
      Buffer.from('old'),
      new Date(Date.now() - DAY_MS),
    );
    provider.s3.putObject(TEST_MEDIA_BUCKET, strayYoung, Buffer.from('young'));

    const jobId = await worker.runtime.boss.send(
      'maintenance.sweep',
      scheduledPayload('maintenance.sweep'),
    );
    await waitForJobState(database, 'maintenance.sweep', jobId ?? '', ['completed']);

    expect(await uploadRow(stale.id)).toMatchObject({
      status: 'rejected',
      rejectReason: 'expired',
    });
    expect(provider.s3.object(TEST_INCOMING_BUCKET, stale.incoming)).toBeUndefined();
    expect((await uploadRow(fresh.id))?.status).toBe('pending');
    expect(provider.s3.object(TEST_INCOMING_BUCKET, fresh.incoming)).toBeDefined();

    expect(provider.s3.object(TEST_MEDIA_BUCKET, kept.media)).toBeDefined();
    expect((await uploadRow(removed.id))?.status).toBe('deleted');
    expect(provider.s3.object(TEST_MEDIA_BUCKET, removed.media)).toBeUndefined();
    expect(provider.s3.object(TEST_MEDIA_BUCKET, strayOld)).toBeUndefined();
    expect(provider.s3.object(TEST_MEDIA_BUCKET, strayYoung)).toBeDefined();
  });
});
