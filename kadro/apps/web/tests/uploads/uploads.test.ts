import {
  completeUploadResponseSchema,
  LIMITS,
  presignUploadResponseSchema,
  uploadStatusResponseSchema,
} from '@kadro/contracts';
import { auditLogs, newId, refreshTokens, teamMembers, type UploadKind, uploads } from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type JobSender } from '../../lib/server/jobs/enqueue';
import { installUploadServices, uploadServices } from '../../lib/server/uploads/storage';
import { expectProblem } from '../support/http';
import { storedJobs } from '../support/jobs';
import {
  type Account,
  account,
  addMember,
  DAY_MS,
  expectJson,
  insertTeam,
  teamFixture,
  webAccount,
} from '../teams/support';
import {
  INCOMING_BUCKET,
  MEDIA_BASE_URL,
  parsePresignedPut,
  signatureMatches,
  STORAGE_ENDPOINT,
  setupUploadsHarness,
  type UploadsHarness,
  uploadsApi as api,
} from './support';

/**
 * Upload endpoints (security checklist item 7, ADR-0030, matrix §3.7 footnote 31): presign with a
 * signed exact length and type, the daily quota, badge rights, complete and status, ownership.
 */

let t: UploadsHarness;

beforeAll(async () => {
  t = await setupUploadsHarness('web_uploads');
});

afterAll(async () => {
  await t.dispose();
});

const PNG = 'image/png';

function avatarBody(contentLength = 200_000, contentType: string = PNG) {
  return { kind: 'avatar', contentType, contentLength };
}

async function presigned(headers: Record<string, string>, body: unknown) {
  const response = await api.presign(headers, body);
  return presignUploadResponseSchema.parse(await expectJson(response, 201));
}

async function uploadRow(id: string) {
  const [row] = await t.db.select().from(uploads).where(eq(uploads.id, id));
  return row;
}

async function uploadCount(userId: string): Promise<number> {
  const rows = await t.db
    .select({ id: uploads.id })
    .from(uploads)
    .where(eq(uploads.userId, userId));
  return rows.length;
}

async function uploadJobs(uploadId: string) {
  return (await storedJobs(t.database.url, 'upload.process')).filter(
    (job) => job.data.uploadId === uploadId,
  );
}

async function insertUpload(
  owner: Account,
  values: { kind?: UploadKind; teamId?: string; createdAt?: Date } = {},
): Promise<string> {
  const id = newId();
  const kind = values.kind ?? 'avatar';
  const ownerId = kind === 'avatar' ? owner.id : (values.teamId ?? '');
  const createdAt = values.createdAt ?? t.harness.runtime.now();
  await t.db.insert(uploads).values({
    id,
    userId: owner.id,
    kind,
    teamId: kind === 'badge' ? ownerId : null,
    contentType: PNG,
    contentLength: 1_000,
    status: 'pending',
    key: `${kind === 'avatar' ? 'avatars' : 'badges'}/${ownerId}/${id}`,
    createdAt,
    updatedAt: createdAt,
  });
  return id;
}

/** Same session, new access token at the current (advanced) test time. */
async function renewedHeaders(user: Account): Promise<Record<string, string>> {
  const [family] = await t.db
    .select({ familyId: refreshTokens.familyId })
    .from(refreshTokens)
    .where(eq(refreshTokens.userId, user.id));
  const issued = await t.harness.runtime.accessTokens.issue(
    { userId: user.id, sessionId: family?.familyId ?? '' },
    t.harness.runtime.now(),
  );
  return { ...user.headers, authorization: `Bearer ${issued.token}` };
}

describe('POST uploads/presign', () => {
  it('presigns an avatar PUT that signs exactly content-length, content-type and host', async () => {
    t.harness.setNow(new Date());
    const user = await account(t);
    const now = t.harness.runtime.now();
    const response = await api.presign(user.headers, avatarBody(123_456, 'image/webp'));
    const text = await response.text();
    expect(response.status, text).toBe(201);
    const body = presignUploadResponseSchema.parse(JSON.parse(text));

    expect(body.method).toBe('PUT');
    expect(body.headers).toEqual({ 'Content-Type': 'image/webp', 'Content-Length': '123456' });
    expect(new Date(body.expiresAt).getTime()).toBe(
      now.getTime() + LIMITS.uploadUrlTtlSeconds * 1_000,
    );
    const signed = parsePresignedPut(body.url);
    expect(signed.url.origin).toBe(STORAGE_ENDPOINT);
    expect(signed.url.pathname).toBe(
      `/${INCOMING_BUCKET}/incoming/avatar/${user.id}/${body.uploadId}`,
    );
    expect(signed.signedHeaders).toEqual(['content-length', 'content-type', 'host']);
    expect(signed.expiresSeconds).toBe(LIMITS.uploadUrlTtlSeconds);
    expect(Math.abs(signed.signedAt.getTime() - now.getTime())).toBeLessThan(1_000);
    expect(signed.url.searchParams.get('X-Amz-Content-Sha256')).toBe('UNSIGNED-PAYLOAD');
    expect([...signed.url.searchParams.keys()].some((key) => /checksum/i.test(key))).toBe(false);

    // Object storage recomputes the signature from the request headers.
    const exact = { 'content-length': '123456', 'content-type': 'image/webp' };
    expect(signatureMatches(signed, t.storage.secretAccessKey, exact)).toBe(true);
    expect(
      signatureMatches(signed, t.storage.secretAccessKey, { ...exact, 'content-length': '123457' }),
    ).toBe(false);
    expect(
      signatureMatches(signed, t.storage.secretAccessKey, {
        ...exact,
        'content-length': String(LIMITS.uploadBytes.max + 1),
      }),
    ).toBe(false);
    expect(
      signatureMatches(signed, t.storage.secretAccessKey, { ...exact, 'content-type': PNG }),
    ).toBe(false);

    // No secret, no published key and no bucket credential beyond the key id in the response.
    expect(text).not.toContain(t.storage.secretAccessKey);
    expect(text).not.toContain(`avatars/${user.id}`);
    expect(Object.keys(body).sort()).toEqual(['expiresAt', 'headers', 'method', 'uploadId', 'url']);

    const row = await uploadRow(body.uploadId);
    expect(row).toMatchObject({
      userId: user.id,
      kind: 'avatar',
      teamId: null,
      contentType: 'image/webp',
      contentLength: 123_456,
      status: 'pending',
      rejectReason: null,
      key: `avatars/${user.id}/${body.uploadId}`,
    });
    const audit = await t.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, body.uploadId), eq(auditLogs.action, 'upload.presign')));
    expect(audit).toHaveLength(1);
    expect(audit[0]?.metadata).toEqual({ kind: 'avatar', teamId: null, contentLength: 123_456 });

    const logs = t.harness.logLines.join('\n');
    expect(logs).not.toContain(t.storage.secretAccessKey);
    expect(logs).not.toContain(signed.signature);
  });

  it('works for web sessions as well', async () => {
    const user = await webAccount(t);
    const body = await presigned(user.headers, avatarBody(LIMITS.uploadBytes.max, 'image/jpeg'));
    expect(body.headers['Content-Length']).toBe(String(LIMITS.uploadBytes.max));
  });

  it('refuses sizes outside 1 byte .. 2 MiB, other types and storage keys (400, no row)', async () => {
    const user = await account(t);
    const bodies: unknown[] = [
      avatarBody(3 * 1_048_576),
      avatarBody(LIMITS.uploadBytes.max + 1),
      avatarBody(0),
      avatarBody(1.5),
      avatarBody(1_000, 'image/gif'),
      avatarBody(1_000, 'image/svg+xml'),
      avatarBody(1_000, 'application/octet-stream'),
      { ...avatarBody(), key: `avatars/${user.id}/${newId()}` },
      { ...avatarBody(), avatarKey: 'avatars/x.webp' },
      { ...avatarBody(), teamId: newId() },
      { kind: 'badge', contentType: PNG, contentLength: 1_000 },
      { kind: 'banner', contentType: PNG, contentLength: 1_000 },
    ];
    for (const body of bodies) {
      await expectProblem(await api.presign(user.headers, body), 400, 'validation_failed');
    }
    expect(await uploadCount(user.id)).toBe(0);
  });

  it('presigns badges for captain and co-captain only (player 403, outsider and unknown 404)', async () => {
    const team = await teamFixture(t);
    const outsider = await account(t);
    for (const staff of [team.captain, team.coCaptain]) {
      const body = await presigned(staff.headers, {
        kind: 'badge',
        teamId: team.id,
        contentType: PNG,
        contentLength: 50_000,
      });
      const signed = parsePresignedPut(body.url);
      expect(signed.url.pathname).toBe(
        `/${INCOMING_BUCKET}/incoming/badge/${team.id}/${body.uploadId}`,
      );
      expect(await uploadRow(body.uploadId)).toMatchObject({
        userId: staff.id,
        kind: 'badge',
        teamId: team.id,
        key: `badges/${team.id}/${body.uploadId}`,
      });
    }
    const badge = { kind: 'badge', teamId: team.id, contentType: PNG, contentLength: 50_000 };
    await expectProblem(await api.presign(team.player.headers, badge), 403, 'forbidden');
    await expectProblem(await api.presign(outsider.headers, badge), 404, 'not_found');
    await expectProblem(
      await api.presign(team.captain.headers, { ...badge, teamId: newId() }),
      404,
      'not_found',
    );
    expect(await uploadCount(team.player.id)).toBe(0);
    expect(await uploadCount(outsider.id)).toBe(0);
  });

  it('refuses a badge for another team even to its own captain elsewhere', async () => {
    const mine = await teamFixture(t);
    const other = await teamFixture(t);
    await expectProblem(
      await api.presign(mine.captain.headers, {
        kind: 'badge',
        teamId: other.id,
        contentType: PNG,
        contentLength: 1_000,
      }),
      404,
      'not_found',
    );
  });

  it('allows exactly 10 presigns per user in 24 h, also when 11 race (group U)', async () => {
    t.harness.setNow(new Date());
    const user = await account(t);
    const responses = await Promise.all(
      Array.from({ length: LIMITS.uploadsPerUserPerDay + 1 }, () =>
        api.presign(user.headers, avatarBody()),
      ),
    );
    const statuses = responses.map((response) => response.status).sort();
    expect(statuses).toEqual([...Array<number>(10).fill(201), 429]);
    const refused = responses.find((response) => response.status === 429);
    expect(Number(refused?.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await uploadCount(user.id)).toBe(LIMITS.uploadsPerUserPerDay);

    // Another user is unaffected; the same user gets a slot back after the rolling day.
    const other = await account(t);
    await presigned(other.headers, avatarBody());
    // The limiter keeps whole sub-window buckets (1/15 of the window) until they have left it.
    t.harness.advance(DAY_MS + 2 * 3_600_000);
    await presigned(await renewedHeaders(user), avatarBody());
    t.harness.setNow(new Date());
  });

  it('counts the quota from the upload rows as well (second layer behind the limiter)', async () => {
    t.harness.setNow(new Date());
    const user = await account(t);
    const now = t.harness.runtime.now().getTime();
    for (let index = 0; index < LIMITS.uploadsPerUserPerDay; index += 1) {
      await insertUpload(user, { createdAt: new Date(now - 60_000 * (index + 1)) });
    }
    const refused = await api.presign(user.headers, avatarBody());
    await expectProblem(refused, 429, 'rate_limited');
    expect(Number(refused.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(await uploadCount(user.id)).toBe(LIMITS.uploadsPerUserPerDay);
  });

  it('answers 503 while upload storage is not configured', async () => {
    const user = await account(t);
    const services = uploadServices(t.harness.runtime);
    installUploadServices(t.harness.runtime, { presigner: null });
    try {
      await expectProblem(
        await api.presign(user.headers, avatarBody()),
        503,
        'service_unavailable',
      );
    } finally {
      installUploadServices(t.harness.runtime, services);
    }
    expect(await uploadCount(user.id)).toBe(0);
  });
});

describe('POST uploads/:id/complete', () => {
  it('moves the upload to processing and enqueues upload.process in the same transaction', async () => {
    t.harness.setNow(new Date());
    const user = await account(t);
    const { uploadId } = await presigned(user.headers, avatarBody());
    const response = await api.complete(user.headers, uploadId);
    expect(completeUploadResponseSchema.parse(await expectJson(response, 202))).toEqual({
      status: 'processing',
    });
    expect((await uploadRow(uploadId))?.status).toBe('processing');
    const jobs = await uploadJobs(uploadId);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.singletonKey).toBe(`upload:${uploadId}`);
    expect(jobs[0]?.data).toEqual({ uploadId, idempotencyKey: `upload:${uploadId}` });
    const audit = await t.db
      .select({ action: auditLogs.action, actorId: auditLogs.actorId })
      .from(auditLogs)
      .where(and(eq(auditLogs.targetId, uploadId), eq(auditLogs.action, 'upload.complete')));
    expect(audit).toEqual([{ action: 'upload.complete', actorId: user.id }]);
  });

  it('is idempotent: a repeated complete changes nothing and enqueues no second job', async () => {
    const user = await account(t);
    const { uploadId } = await presigned(user.headers, avatarBody());
    expect((await api.complete(user.headers, uploadId)).status).toBe(202);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await expectProblem(await api.complete(user.headers, uploadId), 409, 'upload_not_pending');
    }
    expect(await uploadJobs(uploadId)).toHaveLength(1);
    expect((await uploadRow(uploadId))?.status).toBe('processing');
  });

  it('serializes concurrent completes of one upload: one 202, one 409, one job', async () => {
    const user = await account(t);
    const { uploadId } = await presigned(user.headers, avatarBody());
    const responses = await Promise.all([
      api.complete(user.headers, uploadId),
      api.complete(user.headers, uploadId),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    expect(await uploadJobs(uploadId)).toHaveLength(1);
  });

  it("answers 404 for another user's upload and an unknown id, leaving the upload pending", async () => {
    const owner = await account(t);
    const attacker = await account(t);
    const { uploadId } = await presigned(owner.headers, avatarBody());
    await expectProblem(await api.complete(attacker.headers, uploadId), 404, 'not_found');
    await expectProblem(await api.complete(owner.headers, newId()), 404, 'not_found');
    await expectProblem(await api.complete(owner.headers, 'not-a-uuid'), 400, 'validation_failed');
    await expectProblem(
      await api.complete(owner.headers, uploadId, { key: 'x' }),
      400,
      'validation_failed',
    );
    expect((await uploadRow(uploadId))?.status).toBe('pending');
    expect(await uploadJobs(uploadId)).toHaveLength(0);
  });

  it('refuses completion after the one-hour window and in every non-pending state', async () => {
    t.harness.setNow(new Date());
    const user = await account(t);
    const now = t.harness.runtime.now().getTime();
    const late = await insertUpload(user, {
      createdAt: new Date(now - LIMITS.uploadCompleteWindowSeconds * 1_000),
    });
    await expectProblem(await api.complete(user.headers, late), 409, 'upload_not_pending');
    const inTime = await insertUpload(user, {
      createdAt: new Date(now - LIMITS.uploadCompleteWindowSeconds * 1_000 + 60_000),
    });
    expect((await api.complete(user.headers, inTime)).status).toBe(202);
    for (const status of ['ready', 'rejected', 'deleted'] as const) {
      const id = await insertUpload(user);
      await t.db
        .update(uploads)
        .set({ status, rejectReason: status === 'rejected' ? 'not_an_image' : null })
        .where(eq(uploads.id, id));
      await expectProblem(await api.complete(user.headers, id), 409, 'upload_not_pending');
      expect(await uploadJobs(id)).toHaveLength(0);
    }
    expect(await uploadJobs(late)).toHaveLength(0);
  });

  it('rolls the status change back when the job cannot be enqueued', async () => {
    const user = await account(t);
    const { uploadId } = await presigned(user.headers, avatarBody());
    const runtime = t.harness.runtime as { jobs: JobSender };
    const jobs = runtime.jobs;
    runtime.jobs = { enqueue: () => Promise.reject(new Error('queue unavailable')) };
    try {
      await expectProblem(await api.complete(user.headers, uploadId), 500, 'internal_error');
    } finally {
      runtime.jobs = jobs;
    }
    expect((await uploadRow(uploadId))?.status).toBe('pending');
    expect(
      await t.db
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.targetId, uploadId), eq(auditLogs.action, 'upload.complete'))),
    ).toEqual([]);
    expect((await api.complete(user.headers, uploadId)).status).toBe(202);
  });

  it('completes a badge only for its uploader, not for the other team staff', async () => {
    const team = await teamFixture(t);
    const { uploadId } = await presigned(team.captain.headers, {
      kind: 'badge',
      teamId: team.id,
      contentType: PNG,
      contentLength: 10_000,
    });
    await expectProblem(await api.complete(team.coCaptain.headers, uploadId), 404, 'not_found');
    expect((await api.complete(team.captain.headers, uploadId)).status).toBe(202);
  });
});

describe('GET uploads/:id', () => {
  it('reports pending, processing, ready with the public URL, and rejected with its reason', async () => {
    const user = await account(t);
    const { uploadId } = await presigned(user.headers, avatarBody());
    const read = async () =>
      uploadStatusResponseSchema.parse(
        await expectJson(await api.get(user.headers, uploadId), 200),
      );

    expect(await read()).toEqual({
      id: uploadId,
      kind: 'avatar',
      status: 'pending',
      rejectReason: null,
      url: null,
    });
    await api.complete(user.headers, uploadId);
    expect((await read()).status).toBe('processing');

    await t.db.update(uploads).set({ status: 'ready' }).where(eq(uploads.id, uploadId));
    expect(await read()).toEqual({
      id: uploadId,
      kind: 'avatar',
      status: 'ready',
      rejectReason: null,
      url: `${MEDIA_BASE_URL}/avatars/${user.id}/${uploadId}.webp`,
    });

    await t.db
      .update(uploads)
      .set({ status: 'rejected', rejectReason: 'type_mismatch' })
      .where(eq(uploads.id, uploadId));
    expect(await read()).toEqual({
      id: uploadId,
      kind: 'avatar',
      status: 'rejected',
      rejectReason: 'type_mismatch',
      url: null,
    });
  });

  it("answers 404 for another user's upload (also a teammate's badge) and for unknown ids", async () => {
    const team = await teamFixture(t);
    const badge = await insertUpload(team.captain, { kind: 'badge', teamId: team.id });
    const avatar = await insertUpload(team.captain);
    for (const reader of [team.coCaptain, team.player, await account(t)]) {
      for (const id of [badge, avatar]) {
        await expectProblem(await api.get(reader.headers, id), 404, 'not_found');
      }
    }
    await expectProblem(await api.get(team.captain.headers, newId()), 404, 'not_found');
    expect((await api.get(team.captain.headers, badge)).status).toBe(200);
  });

  it('answers 401 without credentials before anything else', async () => {
    const owner = await account(t);
    const id = await insertUpload(owner);
    const anonymous = { 'x-kadro-client': 'mobile' };
    await expectProblem(await api.get(anonymous, id), 401, 'unauthenticated');
    await expectProblem(await api.complete(anonymous, id), 401, 'unauthenticated');
    await expectProblem(await api.presign(anonymous, avatarBody()), 401, 'unauthenticated');
  });

  it('keeps a badge readable by its uploader after a demotion (ownership, not role)', async () => {
    const captain = await account(t);
    const teamId = await insertTeam(t, captain.id);
    const helper = await account(t);
    await addMember(t, teamId, helper.id, 'co_captain');
    const { uploadId } = await presigned(helper.headers, {
      kind: 'badge',
      teamId,
      contentType: PNG,
      contentLength: 2_000,
    });
    await t.db.update(uploads).set({ status: 'ready' }).where(eq(uploads.id, uploadId));
    await t.db
      .update(teamMembers)
      .set({ role: 'player' })
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, helper.id)));
    const body = uploadStatusResponseSchema.parse(
      await expectJson(await api.get(helper.headers, uploadId), 200),
    );
    expect(body.url).toBe(`${MEDIA_BASE_URL}/badges/${teamId}/${uploadId}.webp`);
  });
});
