import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';

import { QUERY_ROOTS, queryKeys } from '../query/keys';
import { type MatchSummary, type Paginated } from './contracts';
import { type MatchesApi } from './matches-api';

/**
 * Query keys of the matches area. Match data lives under the persisted `matches` root, so the
 * last copy of a match is shown offline; `teamAll` sits below `queryKeys.teamMatches`, so
 * invalidating (or, after leaving a team, removing) the team's matches covers both lists.
 */
export const matchKeys = {
  detail: (matchId: string) => [QUERY_ROOTS.matches, 'detail', matchId] as const,
  teamAll: (teamId: string) => [...queryKeys.teamMatches(teamId), 'all'] as const,
  venueSearch: (q: string) => [QUERY_ROOTS.venues, 'search', q] as const,
};

/** One match: member or guest projection, as the server decides. */
export function matchDetailQuery(matches: MatchesApi, matchId: string) {
  return queryOptions({
    queryKey: matchKeys.detail(matchId),
    queryFn: ({ signal }) => matches.getMatch(matchId, signal),
  });
}

/** Every match of a team, newest start first (server order), page by page. */
export function teamAllMatchesQuery(matches: MatchesApi, teamId: string) {
  return infiniteQueryOptions({
    queryKey: matchKeys.teamAll(teamId),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page: Paginated<MatchSummary>) => page.nextCursor ?? undefined,
    queryFn: ({ pageParam, signal }) => matches.listTeamMatches(teamId, pageParam, signal),
  });
}

/** Directory venues matching a search term (public data). */
export function venueSearchQuery(matches: MatchesApi, q: string) {
  return queryOptions({
    queryKey: matchKeys.venueSearch(q),
    queryFn: ({ signal }) => matches.searchVenues(q, signal),
  });
}
