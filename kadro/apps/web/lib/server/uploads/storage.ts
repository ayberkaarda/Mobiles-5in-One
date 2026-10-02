import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type UploadContentType, LIMITS } from '@kadro/contracts';
import { type WebEnv } from '@kadro/config';

import { type ServerRuntime } from '../runtime';

/**
 * Presigned uploads into the private incoming bucket (ADR-0030, security checklist item 7).
 *
 * The URL is a SigV4 query-signed `PUT` whose `X-Amz-SignedHeaders` are exactly
 * `content-length;content-type;host`: object storage recomputes the signature from the headers the
 * client sends, so a body of another length or another type is refused there (403). No payload
 * checksum is added (`UNSIGNED-PAYLOAD`), the URL is valid for `LIMITS.uploadUrlTtlSeconds`, and
 * signing happens locally; nothing is sent to object storage. The web key needs `PutObject` on
 * the incoming bucket only.
 */

export interface PresignPutInput {
  readonly key: string;
  readonly contentType: UploadContentType;
  readonly contentLength: number;
  /** Signing time; the URL expires `LIMITS.uploadUrlTtlSeconds` later. */
  readonly signedAt: Date;
}

export interface UploadPresigner {
  presignPut(input: PresignPutInput): Promise<string>;
}

/** Headers that must be signed; everything else is left out of the signature. */
export const SIGNED_UPLOAD_HEADERS = ['content-length', 'content-type'] as const;

export type UploadStorageEnv = Pick<
  WebEnv,
  'R2_ENDPOINT' | 'R2_ACCESS_KEY_ID' | 'R2_SECRET_ACCESS_KEY' | 'R2_INCOMING_BUCKET'
>;

/** S3 presigner for the configured incoming bucket, or `null` when storage is not configured. */
export function createS3Presigner(env: UploadStorageEnv): UploadPresigner | null {
  const endpoint = env.R2_ENDPOINT;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_INCOMING_BUCKET;
  if (
    endpoint === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    bucket === undefined
  ) {
    return null;
  }
  const client = new S3Client({
    endpoint,
    region: 'auto',
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey },
    // No checksum parameters in the URL: the client sends a plain body of the signed length.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const signed = new Set<string>(SIGNED_UPLOAD_HEADERS);
  return {
    presignPut(input) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          ContentType: input.contentType,
          ContentLength: input.contentLength,
        }),
        {
          expiresIn: LIMITS.uploadUrlTtlSeconds,
          signingDate: input.signedAt,
          signableHeaders: signed,
          // Kept as headers: hoisted into the query they would no longer bind the request body.
          unhoistableHeaders: signed,
        },
      );
    },
  };
}

export interface UploadServices {
  /** `null` when the R2 keys are not configured (local development only). */
  readonly presigner: UploadPresigner | null;
}

const SERVICES = new WeakMap<ServerRuntime, UploadServices>();

export function uploadServices(runtime: ServerRuntime): UploadServices {
  let services = SERVICES.get(runtime);
  if (services === undefined) {
    services = { presigner: createS3Presigner(runtime.env) };
    SERVICES.set(runtime, services);
  }
  return services;
}

/** Replaces the upload services of a runtime (tests). */
export function installUploadServices(runtime: ServerRuntime, services: UploadServices): void {
  SERVICES.set(runtime, services);
}
