import { ApiError } from '../api/errors';
import {
  type PresignUploadResponse,
  type UploadContentType,
  type UploadRejectReason,
} from './contracts';
import { type ProfileApi } from './profile-api';

/** Contracts `LIMITS.uploadBytes` and `UPLOAD_CONTENT_TYPES` (tests compare). */
export const AVATAR_MAX_BYTES = 2_097_152;
export const AVATAR_CONTENT_TYPES: readonly UploadContentType[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
];

/** An image the user chose; `uri` is a local file the app may read. */
export interface PickedImage {
  readonly uri: string;
  /** MIME type as the picker reports it, if it does. */
  readonly mimeType: string | null;
}

/**
 * The image picker boundary. The app has no picker module yet (no `expo-image-picker` in the
 * package's dependencies), so the app's instance is `null` and the "change photo" control is not
 * shown; everything after the picker (checks, presign, upload, complete, status) is in place.
 */
export interface AvatarPicker {
  /** Resolves to `null` when the user cancels. */
  pick(): Promise<PickedImage | null>;
  /** Reads the chosen file; the upload sends exactly these bytes. */
  read(image: PickedImage): Promise<Blob>;
}

export type AvatarUploadOutcome =
  | { readonly kind: 'cancelled' }
  /** Refused before anything was sent: type not allowed, empty or larger than 2 MiB. */
  | { readonly kind: 'invalid'; readonly reason: 'type' | 'size' }
  | { readonly kind: 'ready'; readonly url: string | null }
  | { readonly kind: 'rejected'; readonly reason: UploadRejectReason | null }
  /** Handed to the worker, not processed within the wait; the profile shows it once it is. */
  | { readonly kind: 'processing' };

export interface AvatarUploadDeps {
  readonly picker: AvatarPicker;
  readonly profile: Pick<ProfileApi, 'presignAvatar' | 'completeUpload' | 'uploadStatus'>;
  /** PUT to object storage; not the API client (another origin, no bearer token). */
  readonly fetchImpl?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  /** Pauses between status reads after `complete`. */
  readonly pollDelaysMs?: readonly number[];
}

const DEFAULT_POLL_DELAYS_MS = [1_000, 2_000, 3_000, 4_000];

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function contentTypeOf(image: PickedImage, blob: Blob): UploadContentType | null {
  const declared = (blob.type !== '' ? blob.type : (image.mimeType ?? '')).toLowerCase();
  return AVATAR_CONTENT_TYPES.find((type) => type === declared) ?? null;
}

async function put(
  fetchImpl: typeof fetch,
  presigned: PresignUploadResponse,
  body: Blob,
): Promise<void> {
  let response: Response;
  try {
    // Exactly the signed headers: another type or length fails at object storage.
    response = await fetchImpl(presigned.url, {
      method: presigned.method,
      headers: presigned.headers,
      body,
      credentials: 'omit',
    });
  } catch (error) {
    throw new ApiError({ kind: 'network', cause: error });
  }
  if (!response.ok) {
    throw new ApiError({ kind: 'problem', status: response.status });
  }
}

/**
 * Avatar upload (ADR-0030): pick, check type and size on the device, presign with the exact
 * length, PUT the bytes with the signed headers, `complete`, then read the status a few times.
 * The client never names a storage key; the worker re-encodes the image and sets the avatar.
 * Failures of the API calls and of the PUT reject with an `ApiError`.
 */
export async function uploadAvatar(deps: AvatarUploadDeps): Promise<AvatarUploadOutcome> {
  const image = await deps.picker.pick();
  if (image === null) {
    return { kind: 'cancelled' };
  }
  const blob = await deps.picker.read(image);
  const contentType = contentTypeOf(image, blob);
  if (contentType === null) {
    return { kind: 'invalid', reason: 'type' };
  }
  if (blob.size < 1 || blob.size > AVATAR_MAX_BYTES) {
    return { kind: 'invalid', reason: 'size' };
  }
  const presigned = await deps.profile.presignAvatar(contentType, blob.size);
  await put(deps.fetchImpl ?? fetch, presigned, blob);
  await deps.profile.completeUpload(presigned.uploadId);

  const sleep = deps.sleep ?? defaultSleep;
  for (const delay of deps.pollDelaysMs ?? DEFAULT_POLL_DELAYS_MS) {
    await sleep(delay);
    const status = await deps.profile.uploadStatus(presigned.uploadId);
    if (status.status === 'ready') {
      return { kind: 'ready', url: status.url };
    }
    if (status.status === 'rejected' || status.status === 'deleted') {
      return { kind: 'rejected', reason: status.rejectReason };
    }
  }
  return { kind: 'processing' };
}
