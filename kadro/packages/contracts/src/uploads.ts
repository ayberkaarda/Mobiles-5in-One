import { z } from 'zod';

import { httpsUrlSchema, idSchema, isoDateTimeSchema } from './common.js';
import { LIMITS } from './limits.js';

/**
 * Image uploads (security checklist item 7, ADR-0030). Only avatars and team badges exist. The
 * client never chooses or submits a storage key: the server presigns a PUT to a private incoming
 * bucket with the declared `Content-Type` and exact `Content-Length` signed, the client calls
 * `complete`, and the worker re-encodes the image and applies it to the avatar or badge.
 */
export const UPLOAD_KINDS = ['avatar', 'badge'] as const;
export const uploadKindSchema = z.enum(UPLOAD_KINDS);
export type UploadKind = z.infer<typeof uploadKindSchema>;

export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const uploadContentTypeSchema = z.enum(UPLOAD_CONTENT_TYPES);
export type UploadContentType = z.infer<typeof uploadContentTypeSchema>;

/** `uploads.status` (ADR-0030). */
export const UPLOAD_STATUSES = ['pending', 'processing', 'ready', 'rejected', 'deleted'] as const;
export const uploadStatusSchema = z.enum(UPLOAD_STATUSES);
export type UploadStatus = z.infer<typeof uploadStatusSchema>;

/** `uploads.reject_reason`, set by the worker (ADR-0030). */
export const UPLOAD_REJECT_REASONS = [
  'missing',
  'size_mismatch',
  'not_an_image',
  'type_mismatch',
  'too_many_pixels',
  'decode_failed',
  'expired',
  'not_allowed',
] as const;
export const uploadRejectReasonSchema = z.enum(UPLOAD_REJECT_REASONS);
export type UploadRejectReason = z.infer<typeof uploadRejectReasonSchema>;

/** Path parameters `uploads/:id` and `uploads/:id/complete`. */
export const uploadParamsSchema = z.strictObject({ id: idSchema });
export type UploadParams = z.infer<typeof uploadParamsSchema>;

/**
 * `POST /api/v1/uploads/presign`. `teamId` is required for `badge` (staff of that team only) and
 * forbidden for `avatar`. Size 1 byte .. 2 MiB and the three image types are enforced here; the
 * exact length is then enforced by object storage through the signature.
 */
export const presignUploadRequestSchema = z
  .strictObject({
    kind: uploadKindSchema,
    teamId: idSchema.optional(),
    contentType: uploadContentTypeSchema,
    contentLength: z.int().min(LIMITS.uploadBytes.min).max(LIMITS.uploadBytes.max),
  })
  .refine((body) => (body.kind === 'badge') === (body.teamId !== undefined), {
    message: 'teamId is required for badge uploads and not allowed for avatars',
    path: ['teamId'],
  });
export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>;

/**
 * `POST /api/v1/uploads/presign` 201 response. The client sends exactly `headers` with the PUT;
 * the signature covers them, so another type or size fails at object storage. The URL is valid
 * for five minutes.
 */
export const presignUploadResponseSchema = z.strictObject({
  uploadId: idSchema,
  url: httpsUrlSchema,
  method: z.literal('PUT'),
  headers: z.strictObject({
    'Content-Type': uploadContentTypeSchema,
    'Content-Length': z.string().regex(/^[1-9][0-9]{0,7}$/, 'must be a positive integer'),
  }),
  expiresAt: isoDateTimeSchema,
});
export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>;

/** `POST /api/v1/uploads/:id/complete` body: empty; only the uploader, only from `pending`. */
export const completeUploadRequestSchema = z.strictObject({});
export type CompleteUploadRequest = z.infer<typeof completeUploadRequestSchema>;

/** `POST /api/v1/uploads/:id/complete` 202 response: `upload.process` was enqueued. */
export const completeUploadResponseSchema = z.strictObject({
  status: z.literal('processing'),
});
export type CompleteUploadResponse = z.infer<typeof completeUploadResponseSchema>;

/**
 * `GET /api/v1/uploads/:id` (uploader only). `url` is the public WebP once `ready`;
 * `rejectReason` is set only when `rejected`.
 */
export const uploadStatusResponseSchema = z.strictObject({
  id: idSchema,
  kind: uploadKindSchema,
  status: uploadStatusSchema,
  rejectReason: uploadRejectReasonSchema.nullable(),
  url: httpsUrlSchema.nullable(),
});
export type UploadStatusResponse = z.infer<typeof uploadStatusResponseSchema>;
