import { type ApiClient } from '../api/client';
import {
  type Application,
  type ApplicationStatusTarget,
  type Level,
  type ListDistrictsResponse,
  type OpenCall,
  type OpenCallPublic,
  type Paginated,
  type Position,
  type PublishOpenCallRequest,
} from './contracts';

/** Page size of the open-call list (the API accepts 1..100). */
export const CALL_PAGE_SIZE = 20;
/** Page size of an open call's applications. */
export const APPLICATION_PAGE_SIZE = 50;

/** Filters of `GET open-calls`; `null` means "any". */
export interface CallFilters {
  readonly district: string | null;
  readonly level: Level | null;
  readonly position: Position | null;
}

export const NO_FILTERS: CallFilters = { district: null, level: null, position: null };

/**
 * Calls of the open-call area (product spec §5, `packages/contracts` endpoints `listOpenCalls` ..
 * `decideApplication`, plus `listDistricts` for the district filter). Every call goes through the
 * shared client: bearer token, single-flight refresh, problem details, GET retries only. Ids are
 * URL-encoded; the applicant is always the session's user, never a body field.
 */
export interface CallsApi {
  listOpenCalls(
    filters: CallFilters,
    cursor: string | undefined,
    signal?: AbortSignal,
  ): Promise<Paginated<OpenCallPublic>>;
  listDistricts(signal?: AbortSignal): Promise<ListDistrictsResponse>;
  publishOpenCall(matchId: string, body: PublishOpenCallRequest): Promise<OpenCall>;
  /** Closes the match's open call (`PATCH matches/:id/open-call`, footnote 30). */
  closeOpenCall(matchId: string): Promise<OpenCall>;
  apply(callId: string, message: string | undefined): Promise<Application>;
  listApplications(
    callId: string,
    cursor: string | undefined,
    signal?: AbortSignal,
  ): Promise<Paginated<Application>>;
  /** `accepted` / `rejected` by the call's staff, `withdrawn` by the applicant. */
  setApplicationStatus(
    callId: string,
    applicationId: string,
    status: ApplicationStatusTarget,
  ): Promise<Application>;
}

function callPath(callId: string): string {
  return `/api/v1/open-calls/${encodeURIComponent(callId)}`;
}

function matchCallPath(matchId: string): string {
  return `/api/v1/matches/${encodeURIComponent(matchId)}/open-call`;
}

export function createCallsApi(api: ApiClient): CallsApi {
  return {
    listOpenCalls: (filters, cursor, signal) =>
      api.request<Paginated<OpenCallPublic>>('/api/v1/open-calls', {
        auth: 'optional',
        query: {
          cursor,
          limit: CALL_PAGE_SIZE,
          district: filters.district ?? undefined,
          level: filters.level ?? undefined,
          position: filters.position ?? undefined,
        },
        signal,
      }),
    // Public reference data without a policy action: no credential is sent.
    listDistricts: (signal) =>
      api.request<ListDistrictsResponse>('/api/v1/districts', { auth: 'none', signal }),
    publishOpenCall: (matchId, body) =>
      api.request<OpenCall>(matchCallPath(matchId), { method: 'POST', body }),
    closeOpenCall: (matchId) =>
      api.request<OpenCall>(matchCallPath(matchId), {
        method: 'PATCH',
        body: { status: 'closed' },
      }),
    apply: (callId, message) =>
      api.request<Application>(`${callPath(callId)}/applications`, {
        method: 'POST',
        body: message === undefined ? {} : { message },
      }),
    listApplications: (callId, cursor, signal) =>
      api.request<Paginated<Application>>(`${callPath(callId)}/applications`, {
        query: { cursor, limit: APPLICATION_PAGE_SIZE },
        signal,
      }),
    setApplicationStatus: (callId, applicationId, status) =>
      api.request<Application>(
        `${callPath(callId)}/applications/${encodeURIComponent(applicationId)}`,
        { method: 'PATCH', body: { status } },
      ),
  };
}
