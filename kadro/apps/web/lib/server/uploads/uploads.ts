import {
  type CompleteUploadResponse,
  LIMITS,
  type PresignUploadRequest,
  type PresignUploadResponse,
  type UploadStatusResponse,
} from '@kadro/contracts';
import { newId, type Transaction, uploads } from '@kadro/db';
import { and, asc, count, eq, gt, sql } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { loadTeamRelation, loadUploadOwnership } from '../domain/relations';
import { ApiError } from '../errors';
import { type RequestContext } from '../http';
import { type ServerRuntime } from '../runtime';
import { actorIdOf } from '../teams/context';
import { incomingKey, mediaKey, publishedKey } from './keys';
import { uploadServices } from './storage';
import { mediaUrl } from './urls';

/**
 * Upload endpoints (security checklist item 7, ADR-0030, authorization matrix §3.7 and footnote
 * 31): presign, complete, status. Bytes never pass through the API; the worker re-encodes them
 * (`upload.process`) and applies the result after re-checking the uploader's rights.
 */

export interface UploadRequest {
  readonly ctx: RequestContext;
  readonly runtime: ServerRuntime;
}

const DAY_MS = 86_400_000;

/**
 * Serializes the presigns of one user for the rest of the transaction, so the daily quota counted
 * from `uploads` below cannot be passed by concurrent requests.
 */
async function lockUploadQuota(tx: Transaction, userId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`upload-quota:${userId}`}, 0))`,
  );
}

/**
 * Second quota layer behind rate-limit group U: presigns of the user in the last 24 hours, counted
 * from the upload rows themselves. 429 `rate_limited` with the time until the oldest one leaves
 * the window.
 */
async function assertDailyQuota(tx: Transaction, userId: string, now: Date): Promise<void> {
  const since = new Date(now.getTime() - DAY_MS);
  const [row] = await tx
    .select({ total: count() })
    .from(uploads)
    .where(and(eq(uploads.userId, userId), gt(uploads.createdAt, since)));
  if ((row?.total ?? 0) < LIMITS.uploadsPerUserPerDay) {
    return;
  }
  const [oldest] = await tx
    .select({ createdAt: uploads.createdAt })
    .from(uploads)
    .where(and(eq(uploads.userId, userId), gt(uploads.createdAt, since)))
    .orderBy(asc(uploads.createdAt))
    .limit(1);
  const retryAfterMs = (oldest?.createdAt.getTime() ?? now.getTime()) + DAY_MS - now.getTime();
  throw new ApiError('rate_limited', {
    headers: { 'Retry-After': String(Math.max(1, Math.ceil(retryAfterMs / 1_000))) },
  });
}

/**
 * `POST uploads/presign`. Avatar: any authenticated user. Badge: captain or co-captain of
 * `teamId` (non-members 404, players 403). Type and size were validated by the body schema
 * (1 byte .. 2 MiB, JPEG / PNG / WebP); the exact length and type are then bound by the
 * signature. The `uploads` row (`pending`) and the URL are created together; the response names
 * no storage key, bucket credential or secret.
 */
export async function presignUpload(
  { ctx, runtime }: UploadRequest,
  body: PresignUploadRequest,
): Promise<PresignUploadResponse> {
  const actorId = actorIdOf(ctx);
  let ownerId = actorId;
  if (body.kind === 'badge') {
    const teamId = body.teamId ?? '';
    const relation = await loadTeamRelation(runtime.db, actorId, teamId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('upload.presign.badge', relation.facts);
    ownerId = relation.teamId;
  } else {
    await ctx.authorize('upload.presign.avatar');
  }

  const { presigner } = uploadServices(runtime);
  if (presigner === null) {
    throw new ApiError('service_unavailable', { headers: { 'Retry-After': '60' } });
  }

  return runtime.db.transaction(async (tx) => {
    const now = runtime.now();
    await lockUploadQuota(tx, actorId);
    await assertDailyQuota(tx, actorId, now);
    if (body.kind === 'badge') {
      // Re-read under the transaction: a demotion committed since the check above wins.
      const relation = await loadTeamRelation(tx, actorId, ownerId);
      if (relation === null) {
        throw new ApiError('not_found');
      }
      await ctx.authorize('upload.presign.badge', relation.facts);
    }

    const uploadId = newId();
    const keys = { kind: body.kind, ownerId, uploadId };
    await tx.insert(uploads).values({
      id: uploadId,
      userId: actorId,
      kind: body.kind,
      teamId: body.kind === 'badge' ? ownerId : null,
      contentType: body.contentType,
      contentLength: body.contentLength,
      status: 'pending',
      key: publishedKey(keys),
      createdAt: now,
      updatedAt: now,
    });
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'upload.presign',
      targetType: 'upload',
      targetId: uploadId,
      ip: ctx.ip,
      metadata: {
        kind: body.kind,
        teamId: body.kind === 'badge' ? ownerId : null,
        contentLength: body.contentLength,
      },
    });
    const url = await presigner.presignPut({
      key: incomingKey(keys),
      contentType: body.contentType,
      contentLength: body.contentLength,
      signedAt: now,
    });
    return {
      uploadId,
      url,
      method: 'PUT',
      headers: {
        'Content-Type': body.contentType,
        'Content-Length': String(body.contentLength),
      },
      expiresAt: new Date(now.getTime() + LIMITS.uploadUrlTtlSeconds * 1_000).toISOString(),
    };
  });
}

/**
 * `POST uploads/:id/complete` (uploader only, others 404). Only from `pending` and within
 * `LIMITS.uploadCompleteWindowSeconds` of the presign; anything else is 409 `upload_not_pending`
 * and changes nothing, so a repeated call never enqueues a second job. The status change, the
 * `upload.process` job (key `upload:<id>`) and the audit row commit together.
 */
export async function completeUpload(
  { ctx, runtime }: UploadRequest,
  uploadId: string,
): Promise<CompleteUploadResponse> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    // Row lock first: two concurrent completes are serialized and the second sees `processing`.
    await tx
      .select({ id: uploads.id })
      .from(uploads)
      .where(and(eq(uploads.id, uploadId), eq(uploads.userId, actorId)))
      .for('update');
    const ownership = await loadUploadOwnership(tx, actorId, uploadId);
    await ctx.authorize('upload.complete', ownership.facts);
    const upload = ownership.upload;
    if (upload === null) {
      throw new ApiError('not_found');
    }
    const now = runtime.now();
    const windowEnds = upload.createdAt.getTime() + LIMITS.uploadCompleteWindowSeconds * 1_000;
    if (upload.status !== 'pending' || now.getTime() >= windowEnds) {
      throw new ApiError('upload_not_pending');
    }
    await tx
      .update(uploads)
      .set({ status: 'processing', updatedAt: now })
      .where(and(eq(uploads.id, upload.id), eq(uploads.status, 'pending')));
    await runtime.jobs.enqueue(
      tx,
      'upload.process',
      { uploadId: upload.id },
      { idempotencyKey: `upload:${upload.id}` },
    );
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'upload.complete',
      targetType: 'upload',
      targetId: upload.id,
      ip: ctx.ip,
      metadata: { kind: upload.kind },
    });
    return { status: 'processing' };
  });
}

/**
 * `GET uploads/:id` (uploader only, others 404): status, the worker's reject reason, and the
 * public URL of the processed image once `ready`.
 */
export async function getUpload(
  { ctx, runtime }: UploadRequest,
  uploadId: string,
): Promise<UploadStatusResponse> {
  const actorId = actorIdOf(ctx);
  const ownership = await loadUploadOwnership(runtime.db, actorId, uploadId);
  await ctx.authorize('upload.read', ownership.facts);
  if (ownership.upload === null) {
    throw new ApiError('not_found');
  }
  const [row] = await runtime.db
    .select({
      id: uploads.id,
      kind: uploads.kind,
      status: uploads.status,
      rejectReason: uploads.rejectReason,
      key: uploads.key,
    })
    .from(uploads)
    .where(and(eq(uploads.id, ownership.upload.id), eq(uploads.userId, actorId)))
    .limit(1);
  if (row === undefined) {
    throw new ApiError('not_found');
  }
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    rejectReason: row.status === 'rejected' ? row.rejectReason : null,
    url:
      row.status === 'ready'
        ? mediaUrl(runtime.env.MEDIA_PUBLIC_BASE_URL, mediaKey(row.key))
        : null,
  };
}
