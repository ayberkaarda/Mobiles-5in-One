import { inject, Injectable } from '@angular/core';
import { ApiClient, type ApiBytes, type ProgressListener } from './api-client';
import type {
  City,
  CityPack,
  Edit,
  EditProposal,
  Favorite,
  LineDetail,
  LineListItem,
  LineQuery,
  LineVersion,
  Me,
  NearStopsQuery,
  PageQuery,
  PlanRequest,
  PlanResult,
  PresignedUpload,
  PresignRequest,
  StatusResponse,
  StopDetail,
  StopSummary,
  Trace,
  TraceCreated,
  TraceUpload,
} from './api-types';
import { AUTH_STRATEGY } from './auth/auth-strategy';
import { ApiError } from './api-error';
import { FETCH } from './config';
import { newRequestId, send } from './http';

/** Downloads can be large; the API serves the whole city dataset in one body. */
const PACK_TIMEOUT_MS = 60_000;
/** A photo is at most 4 MiB; slow mobile uplinks get a minute. */
const UPLOAD_TIMEOUT_MS = 60_000;
/** Headers a page may not set itself; the browser derives them from the body and the URL. */
const FORBIDDEN_UPLOAD_HEADERS = new Set(['content-length', 'host', 'connection']);
/** A city basemap archive is tens of megabytes. */
const TILES_TIMEOUT_MS = 300_000;
export const MAX_PACK_DATASET_BYTES = 64 * 1024 * 1024;
export const MAX_PACK_BASEMAP_BYTES = 512 * 1024 * 1024;

export interface BytesOptions {
  signal?: AbortSignal;
  onProgress?: ProgressListener;
  /** Expected catalog size, when known; bounded by the endpoint's hard limit. */
  maxBytes?: number;
}

/** Public reads used by search, line and stop pages, offline packs and the planner. */
@Injectable({ providedIn: 'root' })
export class CatalogApi {
  private readonly api = inject(ApiClient);

  cities(signal?: AbortSignal): Promise<City[]> {
    return this.api.request({ method: 'GET', path: '/cities', signal });
  }

  city(slug: string, signal?: AbortSignal): Promise<City> {
    return this.api.request({ method: 'GET', path: '/cities/{slug}', params: { slug }, signal });
  }

  /**
   * The offline dataset. `X-Pack-Request: 1` proves the call comes from code on an allowed
   * origin (a plain link cannot set it), because a download can claim the free first city.
   */
  pack(slug: string, signal?: AbortSignal): Promise<CityPack> {
    return this.api.request({
      method: 'GET',
      path: '/cities/{slug}/pack',
      params: { slug },
      headers: { 'X-Pack-Request': '1' },
      timeoutMs: PACK_TIMEOUT_MS,
      signal,
    });
  }

  /**
   * The offline dataset as raw bytes with progress, for storing and verifying exactly what was
   * received. Same header and entitlement rules as `pack`.
   */
  packBytes(slug: string, options: BytesOptions = {}): Promise<ApiBytes> {
    return this.api.requestBytes(
      {
        method: 'GET',
        path: '/cities/{slug}/pack',
        params: { slug },
        headers: { 'X-Pack-Request': '1' },
        timeoutMs: PACK_TIMEOUT_MS,
        signal: options.signal,
      },
      options.onProgress,
      Math.min(options.maxBytes ?? MAX_PACK_DATASET_BYTES, MAX_PACK_DATASET_BYTES),
    );
  }

  /**
   * The city's PMTiles basemap archive (the API redirects to the tiles host; 404
   * `tiles.not_configured` when there is none). Public, so no credential is sent.
   */
  tilesArchive(slug: string, options: BytesOptions = {}): Promise<ApiBytes> {
    return this.api.requestBytes(
      {
        method: 'GET',
        path: '/cities/{slug}/tiles.pmtiles',
        params: { slug },
        headers: { Accept: 'application/vnd.pmtiles, application/octet-stream' },
        timeoutMs: TILES_TIMEOUT_MS,
        auth: false,
        credentials: 'omit',
        signal: options.signal,
      },
      options.onProgress,
      Math.min(options.maxBytes ?? MAX_PACK_BASEMAP_BYTES, MAX_PACK_BASEMAP_BYTES),
    );
  }

  lines(query: LineQuery, signal?: AbortSignal): Promise<LineListItem[]> {
    return this.api.request({ method: 'GET', path: '/lines', query, signal });
  }

  line(slug: string, city: string, signal?: AbortSignal): Promise<LineDetail> {
    return this.api.request({
      method: 'GET',
      path: '/lines/{slug}',
      params: { slug },
      query: { city },
      signal,
    });
  }

  lineVersions(slug: string, city: string, signal?: AbortSignal): Promise<LineVersion[]> {
    return this.api.request({
      method: 'GET',
      path: '/lines/{slug}/versions',
      params: { slug },
      query: { city },
      signal,
    });
  }

  stop(slug: string, city: string, signal?: AbortSignal): Promise<StopDetail> {
    return this.api.request({
      method: 'GET',
      path: '/stops/{slug}',
      params: { slug },
      query: { city },
      signal,
    });
  }

  stopsNear(query: NearStopsQuery, signal?: AbortSignal): Promise<StopSummary[]> {
    return this.api.request({ method: 'GET', path: '/stops/near', query, signal });
  }

  plan(input: PlanRequest, signal?: AbortSignal): Promise<PlanResult> {
    return this.api.request({ method: 'POST', path: '/plan', body: input, signal });
  }
}

/** The signed-in account: profile, licence, favourites and deletion. */
@Injectable({ providedIn: 'root' })
export class AccountApi {
  private readonly api = inject(ApiClient);
  private readonly strategy = inject(AUTH_STRATEGY);

  me(): Promise<Me> {
    return this.api.request({ method: 'GET', path: '/me' });
  }

  updateDisplayName(displayName: string | null): Promise<Me> {
    return this.api.request({
      method: 'PATCH',
      path: '/me',
      body: { display_name: displayName },
    });
  }

  acceptLicence(): Promise<Me> {
    return this.api.request({ method: 'POST', path: '/me/licence-accept', body: {} });
  }

  /** Re-authenticated deletion (ADR-0026); every local credential is dropped on success. */
  async deleteAccount(password?: string): Promise<StatusResponse> {
    const result = await this.api.request<StatusResponse>({
      method: 'DELETE',
      path: '/me',
      body: password === undefined ? {} : { password },
    });
    await this.strategy.clear();
    return result;
  }

  favorites(): Promise<Favorite[]> {
    return this.api.request({ method: 'GET', path: '/me/favorites' });
  }

  favorite(lineId: string): Promise<Favorite> {
    return this.api.request({
      method: 'GET',
      path: '/me/favorites/{line_id}',
      params: { line_id: lineId },
    });
  }

  addFavorite(lineId: string): Promise<void> {
    return this.api.request({
      method: 'PUT',
      path: '/me/favorites/{line_id}',
      params: { line_id: lineId },
    });
  }

  removeFavorite(lineId: string): Promise<void> {
    return this.api.request({
      method: 'DELETE',
      path: '/me/favorites/{line_id}',
      params: { line_id: lineId },
    });
  }
}

/** Contributor tools: edit proposals, GPS traces and photo uploads. */
@Injectable({ providedIn: 'root' })
export class ContributionApi {
  private readonly api = inject(ApiClient);
  private readonly fetchFn = inject(FETCH);

  myEdits(page: PageQuery = {}, signal?: AbortSignal): Promise<Edit[]> {
    return this.api.request({ method: 'GET', path: '/edits', query: page, signal });
  }

  edit(id: string): Promise<Edit> {
    return this.api.request({ method: 'GET', path: '/edits/{identity}', params: { identity: id } });
  }

  proposeEdit(proposal: EditProposal, signal?: AbortSignal): Promise<Edit> {
    return this.api.request({ method: 'POST', path: '/edits', body: proposal, signal });
  }

  uploadTrace(trace: TraceUpload, signal?: AbortSignal): Promise<TraceCreated> {
    return this.api.request({ method: 'POST', path: '/traces', body: trace, signal });
  }

  trace(id: string): Promise<Trace> {
    return this.api.request({
      method: 'GET',
      path: '/traces/{identity}',
      params: { identity: id },
    });
  }

  deleteTrace(id: string): Promise<void> {
    return this.api.request({
      method: 'DELETE',
      path: '/traces/{identity}',
      params: { identity: id },
    });
  }

  /** A presigned PUT for one photo; the upload itself goes straight to object storage. */
  presignPhoto(input: PresignRequest, signal?: AbortSignal): Promise<PresignedUpload> {
    return this.api.request({ method: 'POST', path: '/media/presign', body: input, signal });
  }

  /**
   * Sends the photo bytes to the presigned URL. It goes to object storage, not the API: no
   * credential, cookie or request id is attached, only the signed headers. The signed
   * `Content-Length` must equal the body size (the store refuses any other length); the
   * browser sets that header from the body itself.
   */
  async uploadPhoto(upload: PresignedUpload, body: Blob, signal?: AbortSignal): Promise<void> {
    const signed = Object.entries(upload.headers).find(
      ([name]) => name.toLowerCase() === 'content-length',
    );
    if (signed && Number(signed[1]) !== body.size) {
      throw new ApiError('invalid_response', 0, 'upload.length_mismatch', 'upload');
    }
    if (!/^https?:\/\//i.test(upload.upload_url)) {
      throw new ApiError('invalid_response', 0, 'upload.bad_url', 'upload');
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(upload.headers)) {
      if (!FORBIDDEN_UPLOAD_HEADERS.has(name.toLowerCase())) headers.set(name, value);
    }
    const requestId = newRequestId();
    await send(
      this.fetchFn,
      upload.upload_url,
      { method: upload.method ?? 'PUT', headers, body, credentials: 'omit' },
      { timeoutMs: UPLOAD_TIMEOUT_MS, signal, requestId },
      async (response) => {
        if (!response.ok) {
          throw new ApiError('http', response.status, `upload.${response.status}`, requestId);
        }
      },
    );
  }
}
