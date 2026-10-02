import { type UploadProcessJob } from '@kadro/contracts';
import {
  type Database,
  type Transaction,
  type Upload,
  type UploadRejectReason,
  teamMembers,
  teams,
  uploads,
  users,
} from '@kadro/db';
import { and, eq, inArray, lt, ne, sql } from 'drizzle-orm';

import { type Clock } from '../clock.js';
import { type JobContext, TransientJobError } from '../job-runner.js';
import { type Buckets, type ObjectStorage } from '../storage/storage.js';
import { MAX_UPLOAD_BYTES, detectImageType, reencodeImage } from './image.js';
import { incomingKey, mediaKey } from './keys.js';

export const MEDIA_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface UploadHandlerDependencies {
  readonly db: Database;
  readonly storage: ObjectStorage;
  readonly buckets: Buckets;
  readonly clock: Clock;
}

/** ADR-0030 step 5: may the uploader still apply this image to its target? */
async function mayApply(tx: Database | Transaction, upload: Upload): Promise<boolean> {
  const [user] = await tx
    .select({ deactivatedAt: users.deactivatedAt, isTombstone: users.isTombstone })
    .from(users)
    .where(eq(users.id, upload.userId));
  if (user === undefined || user.deactivatedAt !== null || user.isTombstone) {
    return false;
  }
  if (upload.kind === 'avatar') {
    return true;
  }
  if (upload.teamId === null) {
    return false;
  }
  const [membership] = await tx
    .select({ role: teamMembers.role })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.teamId, upload.teamId), eq(teamMembers.userId, upload.userId)));
  return membership?.role === 'captain' || membership?.role === 'co_captain';
}

type Applied =
  | { readonly applied: true; readonly replaced: string[] }
  | {
      readonly applied: false;
      readonly outcome: string;
      /**
       * Whether the object this run put may be deleted: never when the upload is `ready`, because
       * another run of the same upload published the same key and the target references it.
       */
      readonly deleteOwnObject: boolean;
    };

/**
 * `upload.process` (ADR-0030): verify, re-encode and publish one image, then apply it to the avatar
 * or badge in one transaction. Rejections complete the job with `rejected_<reason>`; only storage
 * and database failures throw (retry). The incoming object is deleted in every outcome.
 */
export function createUploadProcessHandler(dependencies: UploadHandlerDependencies) {
  const { db, storage, buckets, clock } = dependencies;

  async function reject(upload: Upload, reason: UploadRejectReason): Promise<string> {
    await db
      .update(uploads)
      .set({ status: 'rejected', rejectReason: reason, updatedAt: clock.now() })
      .where(and(eq(uploads.id, upload.id), eq(uploads.status, 'processing')));
    await storage.delete(buckets.incoming, incomingKey(upload));
    return `rejected_${reason}`;
  }

  return async (job: UploadProcessJob, context: JobContext): Promise<string> => {
    const [upload] = await db.select().from(uploads).where(eq(uploads.id, job.uploadId));
    if (upload === undefined) {
      return 'skipped_missing';
    }
    if (upload.status !== 'processing') {
      // Already handled by an earlier run (or never completed): only make sure the raw bytes go.
      await storage.delete(buckets.incoming, incomingKey(upload));
      return 'skipped_status';
    }

    const source = incomingKey(upload);
    const head = await storage.head(buckets.incoming, source, context.signal);
    if (head === null) {
      return reject(upload, 'missing');
    }
    if (head.size !== upload.contentLength || head.size < 1 || head.size > MAX_UPLOAD_BYTES) {
      return reject(upload, 'size_mismatch');
    }
    const bytes = await storage.read(buckets.incoming, source, MAX_UPLOAD_BYTES, context.signal);
    if (bytes === null) {
      return reject(upload, 'missing');
    }
    if (bytes.length !== upload.contentLength) {
      return reject(upload, 'size_mismatch');
    }
    const detected = detectImageType(bytes);
    if (detected === null) {
      return reject(upload, 'not_an_image');
    }
    if (detected !== upload.contentType) {
      return reject(upload, 'type_mismatch');
    }
    const encoded = await reencodeImage(bytes);
    if (!encoded.ok) {
      return reject(upload, encoded.reason);
    }
    if (!(await mayApply(db, upload))) {
      return reject(upload, 'not_allowed');
    }

    const target = mediaKey(upload);
    await storage.put(
      buckets.media,
      target,
      encoded.webp,
      { contentType: 'image/webp', cacheControl: MEDIA_CACHE_CONTROL },
      context.signal,
    );
    // An attempt that outlived its expiry (or a stopping worker) must not apply its result: the
    // retry, or a concurrent run, owns the upload now.
    if (context.signal.aborted) {
      throw new TransientJobError('upload.process attempt aborted after publishing');
    }

    const result = await db.transaction(async (tx): Promise<Applied> => {
      const [locked] = await tx
        .select()
        .from(uploads)
        .where(eq(uploads.id, upload.id))
        .for('update');
      if (locked?.status !== 'processing') {
        return {
          applied: false,
          outcome: 'skipped_status',
          deleteOwnObject: locked !== undefined && locked.status !== 'ready',
        };
      }
      // Lock the target row, then re-check the permission under that lock.
      if (upload.kind === 'avatar') {
        await tx
          .select({ id: users.id })
          .from(users)
          .where(eq(users.id, upload.userId))
          .for('update');
      } else if (upload.teamId !== null) {
        await tx
          .select({ id: teams.id })
          .from(teams)
          .where(eq(teams.id, upload.teamId))
          .for('update');
      }
      const now = clock.now();
      if (!(await mayApply(tx, upload))) {
        await tx
          .update(uploads)
          .set({ status: 'rejected', rejectReason: 'not_allowed', updatedAt: now })
          .where(eq(uploads.id, upload.id));
        // Still `processing` under the lock, so no run has published this key: it is ours.
        return { applied: false, outcome: 'rejected_not_allowed', deleteOwnObject: true };
      }
      const previous = await tx
        .update(uploads)
        .set({ status: 'deleted', updatedAt: now })
        .where(
          and(
            eq(uploads.status, 'ready'),
            eq(uploads.kind, upload.kind),
            ne(uploads.id, upload.id),
            upload.kind === 'avatar'
              ? eq(uploads.userId, upload.userId)
              : eq(uploads.teamId, upload.teamId ?? upload.id),
          ),
        )
        .returning();
      let oldKey: string | null = null;
      if (upload.kind === 'avatar') {
        const [row] = await tx
          .select({ key: users.avatarKey })
          .from(users)
          .where(eq(users.id, upload.userId));
        oldKey = row?.key ?? null;
        await tx
          .update(users)
          .set({ avatarKey: target, updatedAt: now })
          .where(eq(users.id, upload.userId));
      } else if (upload.teamId !== null) {
        const [row] = await tx
          .select({ key: teams.badgeKey })
          .from(teams)
          .where(eq(teams.id, upload.teamId));
        oldKey = row?.key ?? null;
        await tx
          .update(teams)
          .set({ badgeKey: target, updatedAt: now })
          .where(eq(teams.id, upload.teamId));
      }
      await tx
        .update(uploads)
        .set({ status: 'ready', updatedAt: now })
        .where(eq(uploads.id, upload.id));
      const replaced = new Set(previous.map((row) => mediaKey(row)));
      if (oldKey !== null && oldKey !== target) {
        replaced.add(oldKey);
      }
      return { applied: true, replaced: [...replaced] };
    });

    if (!result.applied) {
      if (result.deleteOwnObject) {
        await storage.delete(buckets.media, target);
      }
      await storage.delete(buckets.incoming, source);
      return result.outcome;
    }

    // Replaced images: the database no longer references them. A failure here leaves an orphan
    // that maintenance.sweep removes.
    for (const key of result.replaced) {
      await storage.delete(buckets.media, key).catch((error: unknown) => {
        context.logger.warn({ errorType: (error as Error).name }, 'replaced image not deleted');
      });
    }
    await storage.delete(buckets.incoming, source);
    context.logger.info(
      {
        kind: upload.kind,
        width: encoded.width,
        height: encoded.height,
        replaced: result.replaced.length,
      },
      'upload published',
    );
    return 'ready';
  };
}

/** Uploads still `pending` this long after presign are expired by maintenance.sweep (ADR-0030). */
export const PENDING_UPLOAD_TTL_MS = 60 * 60 * 1_000;

export async function expireStaleUploads(dependencies: UploadHandlerDependencies): Promise<number> {
  const { db, storage, buckets, clock } = dependencies;
  const now = clock.now();
  const stale = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(
      and(
        eq(uploads.status, 'pending'),
        lt(uploads.createdAt, new Date(now.getTime() - PENDING_UPLOAD_TTL_MS)),
      ),
    )
    .limit(1_000);
  if (stale.length === 0) {
    return 0;
  }
  const expired = await db
    .update(uploads)
    .set({ status: 'rejected', rejectReason: 'expired', updatedAt: now })
    .where(
      and(
        inArray(
          uploads.id,
          stale.map((row) => row.id),
        ),
        eq(uploads.status, 'pending'),
      ),
    )
    .returning();
  for (const upload of expired) {
    await storage.delete(buckets.incoming, incomingKey(upload));
  }
  return expired.length;
}

/**
 * An upload still `processing` this long after its last change, with no `upload.process` job left
 * queued, retrying or active, is closed by maintenance.sweep: its job dead-lettered or was lost.
 */
export const PROCESSING_STALE_MS = 60 * 60 * 1_000;

async function hasLiveJob(db: Database, uploadId: string): Promise<boolean> {
  const result = await db.execute<{ found: number }>(
    sql`select 1 as found from pgboss.job
        where name = 'upload.process'
          and data->>'uploadId' = ${uploadId}
          and state in ('created', 'retry', 'active')
        limit 1`,
  );
  return result.rows.length > 0;
}

/**
 * Closes stale `processing` uploads as `rejected` (`expired`, ADR-0030) and deletes their raw
 * object and any WebP a failed attempt already published (unreferenced: the upload never became
 * `ready`). Returns the number of uploads closed.
 */
export async function closeStuckUploads(dependencies: UploadHandlerDependencies): Promise<number> {
  const { db, storage, buckets, clock } = dependencies;
  const now = clock.now();
  const candidates = await db
    .select()
    .from(uploads)
    .where(
      and(
        eq(uploads.status, 'processing'),
        lt(uploads.updatedAt, new Date(now.getTime() - PROCESSING_STALE_MS)),
      ),
    )
    .limit(500);
  let closed = 0;
  for (const upload of candidates) {
    if (await hasLiveJob(db, upload.id)) {
      continue;
    }
    const [row] = await db
      .update(uploads)
      .set({ status: 'rejected', rejectReason: 'expired', updatedAt: now })
      .where(and(eq(uploads.id, upload.id), eq(uploads.status, 'processing')))
      .returning({ id: uploads.id });
    if (row === undefined) {
      continue;
    }
    await storage.delete(buckets.incoming, incomingKey(upload));
    await storage.delete(buckets.media, mediaKey(upload));
    closed += 1;
  }
  return closed;
}
