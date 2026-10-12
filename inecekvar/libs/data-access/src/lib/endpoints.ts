import { inject, Injectable } from '@angular/core';
import { ApiClient } from './api-client';
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

/** Downloads can be large; the API serves the whole city dataset in one body. */
const PACK_TIMEOUT_MS = 60_000;

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

  myEdits(page: PageQuery = {}): Promise<Edit[]> {
    return this.api.request({ method: 'GET', path: '/edits', query: page });
  }

  edit(id: string): Promise<Edit> {
    return this.api.request({ method: 'GET', path: '/edits/{identity}', params: { identity: id } });
  }

  proposeEdit(proposal: EditProposal): Promise<Edit> {
    return this.api.request({ method: 'POST', path: '/edits', body: proposal });
  }

  uploadTrace(trace: TraceUpload): Promise<TraceCreated> {
    return this.api.request({ method: 'POST', path: '/traces', body: trace });
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
  presignPhoto(input: PresignRequest): Promise<PresignedUpload> {
    return this.api.request({ method: 'POST', path: '/media/presign', body: input });
  }
}
