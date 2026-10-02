import {
  type QueryClient,
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import { queryKeys } from '../query/keys';
import {
  type CreateMatchRequest,
  type LineupAssignment,
  type MatchDetail,
  type RsvpChoice,
  type RsvpStatus,
  type UpdateMatchRequest,
} from './contracts';
import { type MatchesApi } from './matches-api';
import { matchKeys } from './queries';

/**
 * Writes of the matches area. Only the RSVP is optimistic: it changes one row the server is about
 * to confirm, and the previous match can be put back exactly. Everything else (create, edit,
 * status changes, cancel, lineup, payment marks, the MVP vote) waits for the server answer.
 *
 * Writes of one match share a mutation key; screens disable the match controls while one runs,
 * so an optimistic RSVP never overlaps another write and a rollback never undoes one.
 */
export const matchWriteKey = (matchId: string) => ['match-write', matchId] as const;

export function useMatchBusy(matchId: string): boolean {
  return useIsMutating({ mutationKey: matchWriteKey(matchId) }) > 0;
}

/** The actor's own RSVP status in either projection. */
export function myRsvpStatus(match: MatchDetail): RsvpStatus | null {
  return match.projection === 'member' ? match.myRsvp : match.myRsvp.status;
}

/**
 * What the server will most likely answer to a choice (ADR-0035): `in` beyond the slots becomes
 * `waitlist` for a team member; a guest is never waitlisted; `in` while already confirmed or
 * waitlisted changes nothing.
 */
export function predictedRsvp(match: MatchDetail, choice: RsvpChoice): RsvpStatus {
  const current = myRsvpStatus(match);
  if (choice !== 'in') {
    return choice;
  }
  if (current === 'in' || current === 'waitlist') {
    return current;
  }
  if (match.projection === 'guest') {
    return 'in';
  }
  return match.counts.in < match.slots ? 'in' : 'waitlist';
}

/** The match with the actor's RSVP set to `status`; a player who leaves `in` loses side and paid. */
export function withOwnRsvp(
  match: MatchDetail,
  myUserId: string | null,
  status: RsvpStatus,
): MatchDetail {
  const confirmed = status === 'in';
  if (match.projection === 'guest') {
    return {
      ...match,
      myRsvp: {
        ...match.myRsvp,
        status,
        side: confirmed ? match.myRsvp.side : null,
      },
      participants: match.participants.map((row) =>
        row.user.id === myUserId ? { ...row, status, side: confirmed ? row.side : null } : row,
      ),
    };
  }
  const counts = { ...match.counts };
  /* eslint-disable security/detect-object-injection -- keys are typed RsvpStatus values */
  if (match.myRsvp !== null) {
    counts[match.myRsvp] = Math.max(0, counts[match.myRsvp] - 1);
  }
  counts[status] += 1;
  /* eslint-enable security/detect-object-injection */
  return {
    ...match,
    myRsvp: status,
    counts,
    myShareMinor: confirmed ? match.myShareMinor : null,
    participants: match.participants.map((row) =>
      row.user.id === myUserId
        ? {
            ...row,
            status,
            side: confirmed ? row.side : null,
            paid: confirmed ? row.paid : false,
          }
        : row,
    ),
  };
}

/**
 * Marks the match and the team's lists stale and refetches them in the background. Never awaited
 * by a write: a refetch on a weak connection can take the client's full GET retry budget.
 */
function refreshMatch(client: QueryClient, matchId: string, teamId: string): void {
  void client.invalidateQueries({ queryKey: matchKeys.detail(matchId) });
  void client.invalidateQueries({ queryKey: queryKeys.teamMatches(teamId) });
}

interface RsvpChange {
  readonly choice: RsvpChoice;
  /** The viewer's user id, to update their row; `null` while it is not known. */
  readonly myUserId: string | null;
}

interface OptimisticContext {
  readonly previous: MatchDetail | undefined;
  /** The match the write put into the cache; only this exact object is rolled back or confirmed. */
  readonly optimistic: MatchDetail | undefined;
}

/**
 * Own RSVP. The choice shows at once; the server's answer (which may be `waitlist`) replaces it,
 * and a refusal puts the previous match back exactly, unless a refetch has replaced the
 * optimistic match meanwhile (that data is newer and is kept).
 */
export function useSetRsvp(matches: MatchesApi, matchId: string, teamId: string) {
  const client = useQueryClient();
  const key = matchKeys.detail(matchId);
  return useMutation({
    mutationKey: matchWriteKey(matchId),
    mutationFn: ({ choice }: RsvpChange) => matches.setRsvp(matchId, choice),
    onMutate: async ({ choice, myUserId }: RsvpChange): Promise<OptimisticContext> => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<MatchDetail>(key);
      const optimistic =
        previous === undefined
          ? undefined
          : client.setQueryData<MatchDetail>(
              key,
              withOwnRsvp(previous, myUserId, predictedRsvp(previous, choice)),
            );
      return { previous, optimistic };
    },
    onSuccess: (own, { myUserId }, context) => {
      if (context.optimistic !== undefined && client.getQueryData(key) === context.optimistic) {
        client.setQueryData<MatchDetail>(
          key,
          withOwnRsvp(context.optimistic, myUserId, own.status),
        );
      }
    },
    onError: (_error, _change, context) => {
      if (context?.previous === undefined || context.optimistic === undefined) {
        return;
      }
      if (client.getQueryData(key) === context.optimistic) {
        client.setQueryData(key, context.previous);
      }
    },
    onSettled: () => refreshMatch(client, matchId, teamId),
  });
}

export function useCreateMatch(matches: MatchesApi, teamId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMatchRequest) => matches.createMatch(teamId, body),
    onSuccess: (match) => {
      client.setQueryData(matchKeys.detail(match.id), match);
      void client.invalidateQueries({ queryKey: queryKeys.teamMatches(teamId) });
    },
  });
}

/** Edit or status change (`PATCH matches/:id`); the answer is the updated match. */
export function useUpdateMatch(matches: MatchesApi, matchId: string, teamId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: matchWriteKey(matchId),
    mutationFn: (body: UpdateMatchRequest) => matches.updateMatch(matchId, body),
    onSuccess: (match) => {
      client.setQueryData(matchKeys.detail(matchId), match);
      void client.invalidateQueries({ queryKey: queryKeys.teamMatches(teamId) });
    },
  });
}

/** Deletes a draft or cancels an open / locked match. */
export function useDeleteMatch(matches: MatchesApi, matchId: string, teamId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: matchWriteKey(matchId),
    mutationFn: () => matches.deleteMatch(matchId),
    onSuccess: ({ outcome }) => {
      if (outcome === 'deleted') {
        void client.cancelQueries({ queryKey: matchKeys.detail(matchId) });
        client.removeQueries({ queryKey: matchKeys.detail(matchId) });
        void client.invalidateQueries({ queryKey: queryKeys.teamMatches(teamId) });
      } else {
        refreshMatch(client, matchId, teamId);
      }
    },
  });
}

interface SideRow {
  readonly user: { readonly id: string };
  readonly status: RsvpStatus;
  readonly side: LineupAssignment['side'] | null;
}

function applySides<T extends SideRow>(
  rows: readonly T[],
  stored: ReadonlyMap<string, LineupAssignment['side']>,
): T[] {
  // The stored lineup replaces every side: listed players get theirs, other confirmed players
  // none (ADR-0035).
  return rows.map((row) => ({
    ...row,
    side: stored.get(row.user.id) ?? (row.status === 'in' ? null : row.side),
  }));
}

/** The match with the lineup the server stored. */
export function withSides(match: MatchDetail, sides: readonly LineupAssignment[]): MatchDetail {
  const stored = new Map(sides.map((entry) => [entry.userId, entry.side]));
  return match.projection === 'guest'
    ? { ...match, participants: applySides(match.participants, stored) }
    : { ...match, participants: applySides(match.participants, stored) };
}

export function useSetLineup(matches: MatchesApi, matchId: string, teamId: string) {
  const client = useQueryClient();
  const key = matchKeys.detail(matchId);
  return useMutation({
    mutationKey: matchWriteKey(matchId),
    mutationFn: (sides: readonly LineupAssignment[]) => matches.setLineup(matchId, sides),
    onSuccess: ({ sides }) => {
      client.setQueryData<MatchDetail>(key, (match) =>
        match === undefined ? match : withSides(match, sides),
      );
      refreshMatch(client, matchId, teamId);
    },
  });
}

interface PaymentMark {
  readonly userId: string;
  readonly paid: boolean;
}

export function useMarkPayment(matches: MatchesApi, matchId: string, teamId: string) {
  const client = useQueryClient();
  const key = matchKeys.detail(matchId);
  return useMutation({
    mutationKey: matchWriteKey(matchId),
    mutationFn: ({ userId, paid }: PaymentMark) => matches.markPayment(matchId, userId, paid),
    onSuccess: ({ userId, paid }) => {
      client.setQueryData<MatchDetail>(key, (match) =>
        match === undefined || match.projection === 'guest'
          ? match
          : {
              ...match,
              participants: match.participants.map((row) =>
                row.user.id === userId ? { ...row, paid } : row,
              ),
            },
      );
      refreshMatch(client, matchId, teamId);
    },
  });
}

export function useVoteMvp(matches: MatchesApi, matchId: string, teamId: string) {
  const client = useQueryClient();
  const key = matchKeys.detail(matchId);
  return useMutation({
    mutationKey: matchWriteKey(matchId),
    mutationFn: (voteeId: string) => matches.voteMvp(matchId, voteeId),
    onSuccess: ({ voteeId }) => {
      client.setQueryData<MatchDetail>(key, (match) =>
        match === undefined
          ? match
          : { ...match, mvp: { myVoteeId: voteeId, winnerIds: match.mvp?.winnerIds ?? null } },
      );
      refreshMatch(client, matchId, teamId);
    },
  });
}
