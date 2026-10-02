import { type ApiClient } from '../api/client';
import {
  type DeleteAccountRequest,
  type DeleteAccountResponse,
  type MeResponse,
  type MeStatsResponse,
  type PresignUploadResponse,
  type RegisterPushTokenRequest,
  type UpdateMeRequest,
  type UploadContentType,
  type UploadStatusResponse,
} from './contracts';

/**
 * Calls of the own profile, its statistics, avatar uploads, push registration and account
 * deletion (`packages/contracts` endpoints `getMe` .. `deleteMe`, `getMyStats`,
 * `presignUpload`, `completeUpload`, `getUpload`, `registerPushToken`). Every call goes through
 * the shared client (bearer token, single-flight refresh, problem details, GET retries only). The
 * user is always the session's user: no user id is ever part of a path or body.
 */
export interface ProfileApi {
  getStats(signal?: AbortSignal): Promise<MeStatsResponse>;
  updateMe(body: UpdateMeRequest): Promise<MeResponse>;
  presignAvatar(
    contentType: UploadContentType,
    contentLength: number,
  ): Promise<PresignUploadResponse>;
  completeUpload(uploadId: string): Promise<void>;
  uploadStatus(uploadId: string, signal?: AbortSignal): Promise<UploadStatusResponse>;
  registerPushToken(body: RegisterPushTokenRequest): Promise<void>;
  /** Starts the deletion; the server revokes every session of the account at once. */
  deleteAccount(body: DeleteAccountRequest): Promise<DeleteAccountResponse>;
}

function uploadPath(uploadId: string): string {
  return `/api/v1/uploads/${encodeURIComponent(uploadId)}`;
}

export function createProfileApi(api: ApiClient): ProfileApi {
  return {
    getStats: (signal) => api.request<MeStatsResponse>('/api/v1/me/stats', { signal }),
    updateMe: (body) => api.request<MeResponse>('/api/v1/me', { method: 'PATCH', body }),
    presignAvatar: (contentType, contentLength) =>
      api.request<PresignUploadResponse>('/api/v1/uploads/presign', {
        method: 'POST',
        body: { kind: 'avatar', contentType, contentLength },
      }),
    async completeUpload(uploadId) {
      await api.request<unknown>(`${uploadPath(uploadId)}/complete`, { method: 'POST', body: {} });
    },
    uploadStatus: (uploadId, signal) =>
      api.request<UploadStatusResponse>(uploadPath(uploadId), { signal }),
    async registerPushToken(body) {
      await api.request<unknown>('/api/v1/me/push-tokens', { method: 'POST', body });
    },
    deleteAccount: (body) =>
      api.request<DeleteAccountResponse>('/api/v1/me', { method: 'DELETE', body }),
  };
}
