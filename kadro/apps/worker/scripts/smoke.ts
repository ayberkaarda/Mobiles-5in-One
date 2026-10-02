/**
 * Local smoke run of the worker (Phase 2 gate: "worker jobs demonstrated locally").
 *
 * Needs a migrated database, the S3-compatible storage of the R2_* settings and a running worker
 * (`pnpm worker:dev`) on the same DATABASE_URL. Missing local buckets are created.
 * Seeds a few clearly labelled rows, enqueues one job per active queue the way the web app does,
 * waits for the worker to complete each job, checks the effects, prints a summary and removes the
 * seeded rows again.
 *
 *   pnpm --filter @kadro/worker smoke
 */
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { CreateBucketCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { loadWorkerEnv } from '@kadro/config';
import {
  createDbClient,
  deletionRequests,
  districts,
  emailTokens,
  matchRsvps,
  matches,
  newId,
  openCallApplications,
  openCalls,
  pushTokens,
  teamMembers,
  teams,
  uploads,
  users,
} from '@kadro/db';
import { eq, inArray } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import sharp from 'sharp';

import { scheduledPayload } from '../src/boss.js';
import { HOUR_MS, MINUTE_MS } from '../src/clock.js';
import { enqueue } from '../src/enqueue.js';
import { PG_BOSS_SCHEMA } from '../src/queues.js';
import { reminderIdempotencyKey } from '../src/reminders/plan.js';
import { hardDeleteIdempotencyKey } from '../src/maintenance/sweep.js';
import { createS3Storage } from '../src/storage/storage.js';
import { incomingKey, mediaKey } from '../src/uploads/keys.js';

const TIMEOUT_MS = 60_000;
const DAY_MS = 24 * HOUR_MS;

function line(text: string): void {
  process.stdout.write(`${text}\n`);
}

async function main(): Promise<number> {
  const env = loadWorkerEnv();
  if (env.APP_ENV !== 'local') {
    line('smoke: refusing to seed data outside APP_ENV=local');
    return 1;
  }
  const { db, close } = createDbClient({
    connectionString: env.DATABASE_URL,
    applicationName: 'kadro-worker-smoke',
  });
  // A send-only client, configured like the web app's.
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: PG_BOSS_SCHEMA,
    supervise: false,
    schedule: false,
    migrate: false,
    createSchema: false,
    application_name: 'kadro-worker-smoke',
  });
  boss.on('error', () => undefined);
  await boss.start();

  // Local storage only: create the two buckets when they do not exist yet.
  const s3 = new S3Client({
    endpoint: env.R2_ENDPOINT,
    region: 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
  });
  for (const bucket of [env.R2_INCOMING_BUCKET, env.R2_MEDIA_BUCKET]) {
    try {
      await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch {
      await s3.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  }
  const storage = createS3Storage(env);
  const mediaKeys: string[] = [];

  const tag = randomBytes(3).toString('hex');
  const seeded = { users: [] as string[], teams: [] as string[], districts: [] as string[] };
  let failures = 0;
  try {
    // ----- seed -------------------------------------------------------------------------------
    const [district] = await db
      .insert(districts)
      .values({
        il: `Duman ${tag}`,
        ilce: `Duman ${tag}`,
        ilSlug: `duman-${tag}`,
        slug: `duman-${tag}`,
        centroid: { lng: 29, lat: 41 },
      })
      .returning({ id: districts.id });
    if (!district) throw new Error('district insert failed');
    seeded.districts.push(district.id);

    const makeUser = async (label: string, verified: boolean) => {
      const [row] = await db
        .insert(users)
        .values({
          email: `smoke-${label}-${tag}@example.test`,
          displayName: `Duman ${label}`,
          passwordHash: `$argon2id$v=19$m=65536,t=3,p=1$${randomBytes(16).toString('base64')}$${randomBytes(32).toString('base64')}`,
          emailVerifiedAt: verified ? new Date() : null,
        })
        .returning({ id: users.id });
      if (!row) throw new Error('user insert failed');
      seeded.users.push(row.id);
      return row.id;
    };
    const captain = await makeUser('kaptan', true);
    const player = await makeUser('oyuncu', true);
    const newcomer = await makeUser('yeni', false);
    const applicant = await makeUser('aday', true);

    const [team] = await db
      .insert(teams)
      .values({
        name: 'Duman Testi FK',
        slug: `duman-${tag}`,
        districtId: district.id,
        ownerId: captain,
      })
      .returning({ id: teams.id });
    if (!team) throw new Error('team insert failed');
    seeded.teams.push(team.id);
    await db.insert(teamMembers).values([
      { teamId: team.id, userId: captain, role: 'captain' },
      { teamId: team.id, userId: player, role: 'player' },
    ]);
    const startsAt = new Date(Date.now() + 2 * HOUR_MS);
    const [match] = await db
      .insert(matches)
      .values({ teamId: team.id, startsAt, format: '7v7', slots: 14, status: 'open' })
      .returning({ id: matches.id });
    if (!match) throw new Error('match insert failed');
    await db.insert(matchRsvps).values([
      { matchId: match.id, userId: captain, status: 'in' },
      { matchId: match.id, userId: player, status: 'in' },
    ]);
    for (const userId of [captain, player, applicant]) {
      await db.insert(pushTokens).values({
        userId,
        expoToken: `ExponentPushToken[smoke-${randomBytes(8).toString('hex')}]`,
        platform: 'android',
      });
    }
    const [call] = await db
      .insert(openCalls)
      .values({
        matchId: match.id,
        missingCount: 1,
        level: 'casual',
        districtId: district.id,
        expiresAt: new Date(Date.now() - MINUTE_MS),
      })
      .returning({ id: openCalls.id });
    if (!call) throw new Error('open call insert failed');
    await db.insert(openCallApplications).values({ openCallId: call.id, userId: applicant });

    // An avatar upload of the player: raw PNG in the incoming bucket, record in `processing`.
    const avatarBytes = await sharp({
      create: { width: 1600, height: 1200, channels: 3, background: { r: 27, g: 127, b: 75 } },
    })
      .png()
      .toBuffer();
    const uploadId = newId();
    const upload = {
      id: uploadId,
      userId: player,
      kind: 'avatar' as const,
      teamId: null,
      key: `avatars/${player}/${uploadId}`,
    };
    await db.insert(uploads).values({
      ...upload,
      contentType: 'image/png',
      contentLength: avatarBytes.length,
      status: 'processing',
    });
    await storage.put(env.R2_INCOMING_BUCKET, incomingKey(upload), avatarBytes, {
      contentType: 'image/png',
    });
    mediaKeys.push(mediaKey(upload));

    // An account whose deletion grace period is over.
    const leaving = await makeUser('silinen', true);
    await db
      .update(users)
      .set({ deactivatedAt: new Date(Date.now() - 8 * DAY_MS) })
      .where(eq(users.id, leaving));
    const [deletion] = await db
      .insert(deletionRequests)
      .values({
        userId: leaving,
        requestedAt: new Date(Date.now() - 8 * DAY_MS),
        graceUntil: new Date(Date.now() - DAY_MS),
      })
      .returning({ id: deletionRequests.id });
    if (!deletion) throw new Error('deletion request insert failed');

    // ----- enqueue --------------------------------------------------------------------------
    const requestId = `smoke_${tag}`;
    const jobs: { queue: Parameters<PgBoss['getJobById']>[0]; id: string | null; label: string }[] =
      [
        {
          label: 'verify email (token issued by the worker)',
          queue: 'email.send',
          id: await enqueue(boss, 'email.send', {
            kind: 'verify_email',
            userId: newcomer,
            requestId,
            idempotencyKey: `email:verify:${newcomer}:${requestId}`,
          }),
        },
        {
          label: 'forgot password, no account',
          queue: 'email.send',
          id: await enqueue(boss, 'email.send', {
            kind: 'password_reset',
            userId: null,
            requestId,
            idempotencyKey: `email:reset:none:${requestId}`,
          }),
        },
        {
          label: 'push to the captain',
          queue: 'push.send',
          id: await enqueue(boss, 'push.send', {
            type: 'team.member_joined',
            userId: captain,
            refId: team.id,
            idempotencyKey: `push:joined:${team.id}:${requestId}`,
          }),
        },
        {
          label: 'match reminder T-2 h (fan-out)',
          queue: 'match.reminder',
          id: await enqueue(boss, 'match.reminder', {
            matchId: match.id,
            reminder: '2h',
            startsAt: startsAt.toISOString(),
            idempotencyKey: reminderIdempotencyKey(match.id, '2h', startsAt),
          }),
        },
        {
          label: 'avatar upload (re-encode to WebP)',
          queue: 'upload.process',
          id: await enqueue(boss, 'upload.process', {
            uploadId,
            idempotencyKey: `upload:${uploadId}`,
          }),
        },
        {
          label: 'account hard delete after the grace period',
          queue: 'account.hard_delete',
          id: await enqueue(boss, 'account.hard_delete', {
            deletionRequestId: deletion.id,
            idempotencyKey: hardDeleteIdempotencyKey(deletion.id),
          }),
        },
        {
          label: 'open-call expiry (hourly cron)',
          queue: 'opencall.expire',
          id: await boss.send('opencall.expire', scheduledPayload('opencall.expire')),
        },
        {
          label: 'maintenance sweep (hourly cron)',
          queue: 'maintenance.sweep',
          id: await boss.send('maintenance.sweep', scheduledPayload('maintenance.sweep')),
        },
      ];

    // ----- wait -----------------------------------------------------------------------------
    for (const job of jobs) {
      if (job.id === null) {
        line(`FAIL  ${job.queue.padEnd(18)} ${job.label}: not enqueued (duplicate key)`);
        failures += 1;
        continue;
      }
      const deadline = Date.now() + TIMEOUT_MS;
      let state = 'created';
      let output: unknown;
      while (Date.now() < deadline) {
        const found = await boss.getJobById<object>(job.queue, job.id);
        state = found?.state ?? 'missing';
        output = found?.output;
        if (state === 'completed' || state === 'failed') break;
        await delay(250);
      }
      const ok = state === 'completed';
      failures += ok ? 0 : 1;
      line(
        `${ok ? 'OK  ' : 'FAIL'}  ${job.queue.padEnd(18)} ${job.label}: ${state} ${JSON.stringify(output ?? {})}`,
      );
    }

    // ----- effects --------------------------------------------------------------------------
    const tokenRows = await db.select().from(emailTokens).where(eq(emailTokens.userId, newcomer));
    const hashOnly = tokenRows.length === 1 && /^[0-9a-f]{64}$/.test(tokenRows[0]?.tokenHash ?? '');
    line(
      `${hashOnly ? 'OK  ' : 'FAIL'}  email_tokens       one SHA-256 hash stored for the new user`,
    );
    failures += hashOnly ? 0 : 1;

    const fannedOut = await boss.findJobs<{ refId: string }>('push.send', {
      data: { refId: match.id },
    });
    const fanOk = fannedOut.length === 2;
    line(
      `${fanOk ? 'OK  ' : 'FAIL'}  push.send          reminder fanned out to ${fannedOut.length} confirmed players`,
    );
    failures += fanOk ? 0 : 1;

    const [expired] = await db
      .select({ status: openCalls.status })
      .from(openCalls)
      .where(eq(openCalls.id, call.id));
    const [rejected] = await db
      .select({ status: openCallApplications.status })
      .from(openCallApplications)
      .where(eq(openCallApplications.openCallId, call.id));
    const expiryOk = expired?.status === 'expired' && rejected?.status === 'rejected';
    line(
      `${expiryOk ? 'OK  ' : 'FAIL'}  open_calls         call ${expired?.status ?? '?'}, application ${rejected?.status ?? '?'}`,
    );
    failures += expiryOk ? 0 : 1;

    const [uploadRow] = await db.select().from(uploads).where(eq(uploads.id, uploadId));
    const published = await storage.head(env.R2_MEDIA_BUCKET, mediaKey(upload));
    const raw = await storage.head(env.R2_INCOMING_BUCKET, incomingKey(upload));
    const [avatarOwner] = await db
      .select({ key: users.avatarKey })
      .from(users)
      .where(eq(users.id, player));
    const uploadOk =
      uploadRow?.status === 'ready' &&
      published !== null &&
      raw === null &&
      avatarOwner?.key === mediaKey(upload);
    line(
      `${uploadOk ? 'OK  ' : 'FAIL'}  uploads            avatar ${uploadRow?.status ?? '?'}, WebP ${published?.size ?? 0} bytes published, raw object removed`,
    );
    failures += uploadOk ? 0 : 1;

    const [gone] = await db.select({ id: users.id }).from(users).where(eq(users.id, leaving));
    const [request] = await db
      .select({ completedAt: deletionRequests.completedAt })
      .from(deletionRequests)
      .where(eq(deletionRequests.id, deletion.id));
    const deleteOk =
      gone === undefined && request?.completedAt !== null && request?.completedAt !== undefined;
    line(`${deleteOk ? 'OK  ' : 'FAIL'}  deletion_requests  account removed, request completed`);
    failures += deleteOk ? 0 : 1;
    await db.delete(deletionRequests).where(eq(deletionRequests.id, deletion.id));
  } finally {
    // ----- clean up -------------------------------------------------------------------------
    if (seeded.teams.length > 0) {
      await db.delete(matches).where(inArray(matches.teamId, seeded.teams));
      await db.delete(teams).where(inArray(teams.id, seeded.teams));
    }
    if (seeded.users.length > 0) {
      await db.delete(users).where(inArray(users.id, seeded.users));
    }
    if (seeded.districts.length > 0) {
      await db.delete(districts).where(inArray(districts.id, seeded.districts));
    }
    for (const key of mediaKeys) {
      await storage.delete(env.R2_MEDIA_BUCKET, key);
    }
    await boss.stop({ graceful: false });
    await close();
  }
  line(failures === 0 ? 'smoke: all worker jobs completed' : `smoke: ${failures} check(s) failed`);
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `smoke failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  },
);
