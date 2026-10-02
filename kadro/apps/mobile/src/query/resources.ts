import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { type ApiClient } from '../api/client';
import {
  type MatchSummary,
  type MeResponse,
  type OpenCallPublic,
  type Paginated,
  type TeamSummary,
  type VenueSummary,
} from '../api/contracts';
import { queryKeys } from './keys';

/** Page size of the tab lists (the API accepts 1..100, default 20). */
export const LIST_PAGE_SIZE = 20;

function nextCursor<T>(page: Paginated<T>): string | undefined {
  return page.nextCursor ?? undefined;
}

/**
 * Query definitions of the tab lists. Each one reads a cursor-paginated `/api/v1` list
 * (ADR-0039) and is shared by the tab screen and any feature screen that shows the same data.
 */
export function teamsQuery(api: ApiClient) {
  return infiniteQueryOptions({
    queryKey: queryKeys.teams(),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor<TeamSummary>,
    queryFn: ({ pageParam, signal }) =>
      api.request<Paginated<TeamSummary>>('/api/v1/teams', {
        query: { cursor: pageParam, limit: LIST_PAGE_SIZE },
        signal,
      }),
  });
}

export function teamMatchesQuery(api: ApiClient, teamId: string) {
  return queryOptions({
    queryKey: queryKeys.teamMatches(teamId),
    queryFn: ({ signal }) =>
      api.request<Paginated<MatchSummary>>(`/api/v1/teams/${encodeURIComponent(teamId)}/matches`, {
        query: { limit: LIST_PAGE_SIZE },
        signal,
      }),
  });
}

export function openCallsQuery(api: ApiClient) {
  return infiniteQueryOptions({
    queryKey: queryKeys.openCalls(),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor<OpenCallPublic>,
    queryFn: ({ pageParam, signal }) =>
      api.request<Paginated<OpenCallPublic>>('/api/v1/open-calls', {
        auth: 'optional',
        query: { cursor: pageParam, limit: LIST_PAGE_SIZE },
        signal,
      }),
  });
}

export function venuesQuery(api: ApiClient) {
  return infiniteQueryOptions({
    queryKey: queryKeys.venues(),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: nextCursor<VenueSummary>,
    queryFn: ({ pageParam, signal }) =>
      api.request<Paginated<VenueSummary>>('/api/v1/venues', {
        auth: 'optional',
        query: { cursor: pageParam, limit: LIST_PAGE_SIZE },
        signal,
      }),
  });
}

export function meQuery(api: ApiClient) {
  return queryOptions({
    queryKey: queryKeys.me(),
    queryFn: ({ signal }) => api.request<MeResponse>('/api/v1/me', { signal }),
  });
}

/** Matches that are still ahead: not cancelled or played, and not started more than 3 h ago. */
export function upcomingMatches(
  matches: readonly MatchSummary[],
  now: number = Date.now(),
): MatchSummary[] {
  const threshold = now - 3 * 60 * 60 * 1000;
  return matches
    .filter(
      (match) => match.status === 'open' || match.status === 'locked' || match.status === 'draft',
    )
    .filter((match) => Date.parse(match.startsAt) >= threshold)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
