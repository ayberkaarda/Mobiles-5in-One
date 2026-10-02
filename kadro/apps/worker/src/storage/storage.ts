import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { type WorkerEnv } from '@kadro/config';

/**
 * Object storage of the worker (ADR-0030, ADR-0032) over the S3 API: Cloudflare R2 in preview and
 * production, any S3-compatible server locally and in tests. Errors carry the operation and HTTP
 * status only, never keys of other users' objects or credentials.
 */

export interface StoredObject {
  readonly key: string;
  readonly size: number;
  readonly lastModified: Date;
}

export interface PutOptions {
  readonly contentType: string;
  readonly cacheControl?: string;
}

export interface ObjectStorage {
  /** Size of the object, or `null` when it does not exist. */
  head(bucket: string, key: string, signal?: AbortSignal): Promise<{ size: number } | null>;
  /** The first `maxBytes` bytes of the object, or `null` when it does not exist. */
  read(bucket: string, key: string, maxBytes: number, signal?: AbortSignal): Promise<Buffer | null>;
  put(
    bucket: string,
    key: string,
    body: Buffer,
    options: PutOptions,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Deletes the object; a missing object is not an error. */
  delete(bucket: string, key: string): Promise<void>;
  /** One page of objects under `prefix`, oldest listing order of the server. */
  list(
    bucket: string,
    prefix: string,
    continuationToken?: string,
  ): Promise<{ objects: StoredObject[]; next?: string }>;
}

/** Any storage failure other than "not found": transient, the job is retried. */
export class StorageError extends Error {
  constructor(
    readonly operation: 'head' | 'read' | 'put' | 'delete' | 'list',
    readonly status?: number,
  ) {
    super(
      status === undefined
        ? `object storage ${operation} failed`
        : `object storage ${operation} failed (${status})`,
    );
    this.name = 'StorageError';
  }
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return typeof status === 'number' ? status : undefined;
}

export type StorageEnv = Pick<
  WorkerEnv,
  'R2_ENDPOINT' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY'
>;

export function createS3Storage(env: StorageEnv): ObjectStorage {
  const client = new S3Client({
    endpoint: env.R2_ENDPOINT,
    region: 'auto',
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
    // R2 and MinIO accept plain signed bodies; checksums only where an operation requires them.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    maxAttempts: 2,
  });

  return {
    async head(bucket, key, signal) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
          signal ? { abortSignal: signal } : {},
        );
        return { size: result.ContentLength ?? 0 };
      } catch (error) {
        if (statusOf(error) === 404) {
          return null;
        }
        throw new StorageError('head', statusOf(error));
      }
    },
    async read(bucket, key, maxBytes, signal) {
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${maxBytes - 1}` }),
          signal ? { abortSignal: signal } : {},
        );
        if (result.Body === undefined) {
          return Buffer.alloc(0);
        }
        const bytes = Buffer.from(await result.Body.transformToByteArray());
        return bytes.subarray(0, maxBytes);
      } catch (error) {
        if (statusOf(error) === 404) {
          return null;
        }
        throw new StorageError('read', statusOf(error));
      }
    },
    async put(bucket, key, body, options, signal) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentLength: body.length,
            ContentType: options.contentType,
            ...(options.cacheControl ? { CacheControl: options.cacheControl } : {}),
          }),
          signal ? { abortSignal: signal } : {},
        );
      } catch (error) {
        throw new StorageError('put', statusOf(error));
      }
    },
    async delete(bucket, key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      } catch (error) {
        if (statusOf(error) === 404) {
          return;
        }
        throw new StorageError('delete', statusOf(error));
      }
    },
    async list(bucket, prefix, continuationToken) {
      try {
        const result = await client.send(
          new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            MaxKeys: 1_000,
            ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
          }),
        );
        const objects = (result.Contents ?? []).flatMap((entry) =>
          entry.Key === undefined
            ? []
            : [
                {
                  key: entry.Key,
                  size: entry.Size ?? 0,
                  lastModified: entry.LastModified ?? new Date(0),
                },
              ],
        );
        return {
          objects,
          ...(result.IsTruncated && result.NextContinuationToken
            ? { next: result.NextContinuationToken }
            : {}),
        };
      } catch (error) {
        throw new StorageError('list', statusOf(error));
      }
    },
  };
}

/** Deletes every object under `prefix`; returns the number of objects deleted. Idempotent. */
export async function deletePrefix(
  storage: ObjectStorage,
  bucket: string,
  prefix: string,
): Promise<number> {
  let deleted = 0;
  let token: string | undefined;
  do {
    const page = await storage.list(bucket, prefix, token);
    for (const object of page.objects) {
      await storage.delete(bucket, object.key);
      deleted += 1;
    }
    token = page.next;
  } while (token !== undefined);
  return deleted;
}

export interface Buckets {
  readonly incoming: string;
  readonly media: string;
}
