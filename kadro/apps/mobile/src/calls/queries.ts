import {
  type InfiniteData,
  infiniteQueryOptions,
  type QueryClient,
  queryOptions,
} from '@tanstack/react-query';

import { ApiError } from '../api/errors';
import { QUERY_ROOTS, queryKeys } from '../query/keys';
import { type CallFilters, type CallsApi } from './calls-api';
import { type Application, type OpenCall, type OpenCallPublic, type Paginated } from './contracts';

/**
 * Root of the open-call data that stays in memory only. It is not in `PERSISTED_QUERY_ROOTS`
 * (`src/query/persistence.ts`), so it is never written to the device: applications carry other
 * users' notes and profile cards, and the staff view of a call is of no use without them. Like
 * every query, it is dropped at sign-out (`clearQueryCaches`).
 */
export const OPEN_CALL_PRIVATE_ROOT = 'open-call-private';

/**
 * Query keys of the open-call area.
 * Persisted (`open-calls` and `districts` roots, shown offline, cleared at sign-out):
 * - `list(filters)`: one filtered list; `lists()` covers every filter combination.
 * - `call(id)`: the public projection of one call, copied from a list (there is no
 *   `GET open-calls/:id`).
 * - `districts()`: reference data.
 * Memory only (`OPEN_CALL_PRIVATE_ROOT`):
 * - `applications(id)`: what the viewer may read of the call's applications.
 * - `matchCall(matchId)`: the staff view of the match's latest call, as the publish or close
 *   answer returned it (the match response does not carry it); `matchCalls()` covers all.
 */
export const callKeys = {
  lists: () => queryKeys.openCalls(),
  list: (filters: CallFilters) =>
    [
      ...queryKeys.openCalls(),
      { district: filters.district, level: filters.level, position: filters.position },
    ] as const,
  call: (callId: string) => [QUERY_ROOTS.openCalls, 'call', callId] as const,
  applications: (callId: string) => [OPEN_CALL_PRIVATE_ROOT, 'applications', callId] as const,
  matchCalls: () => [OPEN_CALL_PRIVATE_ROOT, 'match'] as const,
  matchCall: (matchId: string) => [OPEN_CALL_PRIVATE_ROOT, 'match', matchId] as const,
  districts: () => [QUERY_ROOTS.districts, 'list'] as const,
};

/** Districts change only through a migration or seed (cacheable for a day, contracts). */
const DISTRICTS_STALE_MS = 24 * 60 * 60 * 1000;

export function openCallListQuery(calls: CallsApi, filters: CallFilters) {
  return infiniteQueryOptions({
    queryKey: callKeys.list(filters),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: Paginated<OpenCallPublic>) => page.nextCursor ?? undefined,
    queryFn: ({ pageParam, signal }) => calls.listOpenCalls(filters, pageParam, signal),
  });
}

export function districtsQuery(calls: CallsApi) {
  return queryOptions({
    queryKey: callKeys.districts(),
    queryFn: ({ signal }) => calls.listDistricts(signal),
    staleTime: DISTRICTS_STALE_MS,
  });
}

function isListData(value: unknown): value is InfiniteData<Paginated<OpenCallPublic>> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { pages?: unknown }).pages)
  );
}

/** The call with this id in any cached list, newest data first; `undefined` when none has it. */
export function findListedCall(client: QueryClient, callId: string): OpenCallPublic | undefined {
  const lists = client
    .getQueryCache()
    .findAll({ queryKey: callKeys.lists() })
    .sort((a, b) => b.state.dataUpdatedAt - a.state.dataUpdatedAt);
  for (const query of lists) {
    const data: unknown = query.state.data;
    if (!isListData(data)) {
      continue;
    }
    for (const page of data.pages) {
      const found = page.items.find((call) => call.id === callId);
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * A listed call that belongs to this match, recognized by team name and start (the public
 * projection carries no match id). Used only to tell staff that a call is already live; it is
 * never used to decide or close anything.
 */
export function findListedCallForMatch(
  client: QueryClient,
  match: { readonly team: { readonly name: string }; readonly startsAt: string },
): OpenCallPublic | undefined {
  const startsAt = Date.parse(match.startsAt);
  for (const query of client.getQueryCache().findAll({ queryKey: callKeys.lists() })) {
    const data: unknown = query.state.data;
    if (!isListData(data)) {
      continue;
    }
    for (const page of data.pages) {
      const found = page.items.find(
        (call) => call.teamName === match.team.name && Date.parse(call.startsAt) === startsAt,
      );
      if (found !== undefined) {
        return found;
      }
    }
  }
  return undefined;
}

/**
 * One call for its detail screen. The API has no single-call read, so the call is taken from the
 * cached lists (fresh copy first), else the copy kept for this screen; `null` when the app has
 * never seen it (a link to a call that is no longer listed).
 */
export function openCallQuery(client: QueryClient, callId: string) {
  return queryOptions({
    queryKey: callKeys.call(callId),
    queryFn: (): OpenCallPublic | null =>
      findListedCall(client, callId) ??
      client.getQueryData<OpenCallPublic | null>(callKeys.call(callId)) ??
      null,
  });
}

/**
 * A page of applications plus whether the viewer has any read relationship to them. A 404 on the
 * first page means "neither staff of the call's team nor an applicant" (ADR-0041, ADR-0013): for
 * the call detail that is the "may apply" state, not a failure.
 */
export interface ApplicationsPage extends Paginated<Application> {
  readonly related: boolean;
}

export function applicationsQuery(calls: CallsApi, callId: string) {
  return infiniteQueryOptions({
    queryKey: callKeys.applications(callId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: ApplicationsPage) => page.nextCursor ?? undefined,
    queryFn: async ({ pageParam, signal }): Promise<ApplicationsPage> => {
      try {
        const page = await calls.listApplications(callId, pageParam, signal);
        return { ...page, related: true };
      } catch (error) {
        if (pageParam === undefined && error instanceof ApiError && error.status === 404) {
          return { items: [], nextCursor: null, related: false };
        }
        throw error;
      }
    },
  });
}

/** The staff view of the match's latest call, kept from the publish / close answer; `null` if none. */
export function matchCallQuery(client: QueryClient, matchId: string) {
  return queryOptions({
    queryKey: callKeys.matchCall(matchId),
    queryFn: (): OpenCall | null =>
      client.getQueryData<OpenCall | null>(callKeys.matchCall(matchId)) ?? null,
    staleTime: Infinity,
  });
}
