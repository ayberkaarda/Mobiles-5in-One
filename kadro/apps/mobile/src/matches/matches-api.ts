import { type ApiClient } from '../api/client';
import {
  type CreateMatchRequest,
  type DeleteMatchResponse,
  type LineupAssignment,
  type LineupResponse,
  type MatchDetail,
  type MatchSummary,
  type MvpVoteResponse,
  type OwnRsvp,
  type Paginated,
  type PaymentResponse,
  type RsvpChoice,
  type UpdateMatchRequest,
  type VenueSummary,
} from './contracts';

/** Page size of a team's match list and of the venue search (the API accepts 1..100). */
export const MATCH_PAGE_SIZE = 20;
export const VENUE_SEARCH_PAGE_SIZE = 10;

/**
 * Calls of the matches area (product spec §5, `packages/contracts` endpoints `listMatches` ..
 * `voteMvp`, plus `listVenues` for picking a directory venue). Every call goes through the shared
 * client: bearer token, single-flight refresh, problem details, GET retries only. Ids are
 * URL-encoded; the user of an RSVP or a vote always comes from the session, never from the body.
 */
export interface MatchesApi {
  listTeamMatches(
    teamId: string,
    cursor: string | undefined,
    signal?: AbortSignal,
  ): Promise<Paginated<MatchSummary>>;
  getMatch(matchId: string, signal?: AbortSignal): Promise<MatchDetail>;
  createMatch(teamId: string, body: CreateMatchRequest): Promise<MatchDetail>;
  updateMatch(matchId: string, body: UpdateMatchRequest): Promise<MatchDetail>;
  /** A `draft` is removed; an `open` or `locked` match is cancelled (footnote 13). */
  deleteMatch(matchId: string): Promise<DeleteMatchResponse>;
  setRsvp(matchId: string, status: RsvpChoice): Promise<OwnRsvp>;
  setLineup(matchId: string, sides: readonly LineupAssignment[]): Promise<LineupResponse>;
  markPayment(matchId: string, userId: string, paid: boolean): Promise<PaymentResponse>;
  voteMvp(matchId: string, voteeId: string): Promise<MvpVoteResponse>;
  searchVenues(q: string, signal?: AbortSignal): Promise<Paginated<VenueSummary>>;
}

function matchPath(matchId: string): string {
  return `/api/v1/matches/${encodeURIComponent(matchId)}`;
}

export function createMatchesApi(api: ApiClient): MatchesApi {
  return {
    listTeamMatches: (teamId, cursor, signal) =>
      api.request<Paginated<MatchSummary>>(`/api/v1/teams/${encodeURIComponent(teamId)}/matches`, {
        query: { cursor, limit: MATCH_PAGE_SIZE },
        signal,
      }),
    getMatch: (matchId, signal) => api.request<MatchDetail>(matchPath(matchId), { signal }),
    createMatch: (teamId, body) =>
      api.request<MatchDetail>(`/api/v1/teams/${encodeURIComponent(teamId)}/matches`, {
        method: 'POST',
        body,
      }),
    updateMatch: (matchId, body) =>
      api.request<MatchDetail>(matchPath(matchId), { method: 'PATCH', body }),
    deleteMatch: (matchId) =>
      api.request<DeleteMatchResponse>(matchPath(matchId), { method: 'DELETE' }),
    setRsvp: (matchId, status) =>
      api.request<OwnRsvp>(`${matchPath(matchId)}/rsvp`, { method: 'PUT', body: { status } }),
    setLineup: (matchId, sides) =>
      api.request<LineupResponse>(`${matchPath(matchId)}/lineup`, {
        method: 'PUT',
        body: { sides: sides.map(({ userId, side }) => ({ userId, side })) },
      }),
    markPayment: (matchId, userId, paid) =>
      api.request<PaymentResponse>(`${matchPath(matchId)}/payments/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: { paid },
      }),
    voteMvp: (matchId, voteeId) =>
      api.request<MvpVoteResponse>(`${matchPath(matchId)}/mvp-vote`, {
        method: 'POST',
        body: { voteeId },
      }),
    searchVenues: (q, signal) =>
      api.request<Paginated<VenueSummary>>('/api/v1/venues', {
        auth: 'optional',
        query: { q, limit: VENUE_SEARCH_PAGE_SIZE },
        signal,
      }),
  };
}
