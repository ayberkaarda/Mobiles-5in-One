import {
  type InfiniteData,
  type QueryClient,
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import { type Paginated, type TeamDetail, type TeamRole, type TeamSummary } from '../api/contracts';
import { queryKeys } from '../query/keys';
import { type TeamsApi } from './teams-api';

/**
 * Writes of the teams area. Optimistic only where the outcome is a single field the server is
 * about to confirm and a rollback is exact: a role change between co-captain and player, and the
 * removal of another member. Everything with wider effects (captaincy transfer, leaving, joining,
 * creating, invites) waits for the server answer.
 *
 * Roster writes of one team share a mutation key; screens disable roster controls while one runs,
 * so two optimistic writes never overlap and a rollback never undoes another write.
 */
export const rosterMutationKey = (teamId: string) => ['team-roster', teamId] as const;

export function useRosterBusy(teamId: string): boolean {
  return useIsMutating({ mutationKey: rosterMutationKey(teamId) }) > 0;
}

function withMemberRole(team: TeamDetail, userId: string, role: TeamRole): TeamDetail {
  return {
    ...team,
    members: team.members.map((member) =>
      member.user.id === userId ? { ...member, role } : member,
    ),
  };
}

function withoutMember(team: TeamDetail, userId: string): TeamDetail {
  const members = team.members.filter((member) => member.user.id !== userId);
  return { ...team, members, memberCount: Math.max(1, team.memberCount - 1) };
}

type TeamPages = InfiniteData<Paginated<TeamSummary>, string | undefined>;

function dropFromTeamList(client: QueryClient, teamId: string): void {
  client.setQueryData<TeamPages>(queryKeys.teams(), (data) =>
    data === undefined
      ? data
      : {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.filter((team) => team.id !== teamId),
          })),
        },
  );
}

async function refreshTeam(client: QueryClient, teamId: string): Promise<void> {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.teamDetail(teamId) }),
    client.invalidateQueries({ queryKey: queryKeys.teams() }),
  ]);
}

interface RoleChange {
  readonly userId: string;
  readonly role: TeamRole;
}

/** Role change; `captain` is a captaincy transfer (ADR-0008) and is not applied in advance. */
export function useChangeMemberRole(teams: TeamsApi, teamId: string) {
  const client = useQueryClient();
  const key = queryKeys.teamDetail(teamId);
  return useMutation({
    mutationKey: rosterMutationKey(teamId),
    mutationFn: ({ userId, role }: RoleChange) => teams.updateMemberRole(teamId, userId, role),
    onMutate: async ({ userId, role }: RoleChange) => {
      if (role === 'captain') {
        return { previous: undefined };
      }
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<TeamDetail>(key);
      if (previous !== undefined) {
        client.setQueryData<TeamDetail>(key, withMemberRole(previous, userId, role));
      }
      return { previous };
    },
    onError: (_error, _change, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(key, context.previous);
      }
    },
    onSettled: () => refreshTeam(client, teamId),
  });
}

/** Removes another member; the row disappears at once and returns if the server refuses. */
export function useRemoveMember(teams: TeamsApi, teamId: string) {
  const client = useQueryClient();
  const key = queryKeys.teamDetail(teamId);
  return useMutation({
    mutationKey: rosterMutationKey(teamId),
    mutationFn: (userId: string) => teams.removeMember(teamId, userId),
    onMutate: async (userId: string) => {
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<TeamDetail>(key);
      if (previous !== undefined) {
        client.setQueryData<TeamDetail>(key, withoutMember(previous, userId));
      }
      return { previous };
    },
    onError: (_error, _userId, context) => {
      if (context?.previous !== undefined) {
        client.setQueryData(key, context.previous);
      }
    },
    onSettled: () => refreshTeam(client, teamId),
  });
}

/** Leaves the team. Its cached roster and matches are dropped only after the server agrees. */
export function useLeaveTeam(teams: TeamsApi, teamId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: rosterMutationKey(teamId),
    mutationFn: (myUserId: string) => teams.removeMember(teamId, myUserId),
    onSuccess: async () => {
      await client.cancelQueries({ queryKey: queryKeys.teamDetail(teamId) });
      client.removeQueries({ queryKey: queryKeys.teamDetail(teamId) });
      client.removeQueries({ queryKey: queryKeys.teamMatches(teamId) });
      client.removeQueries({ queryKey: queryKeys.teamInvites(teamId) });
      dropFromTeamList(client, teamId);
      await client.invalidateQueries({ queryKey: queryKeys.teams() });
    },
  });
}

export function useCreateTeam(teams: TeamsApi) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; districtId: string }) => teams.createTeam(body),
    onSuccess: async (team) => {
      client.setQueryData(queryKeys.teamDetail(team.id), team);
      await client.invalidateQueries({ queryKey: queryKeys.teams() });
    },
  });
}

export function useAcceptInvite(teams: TeamsApi) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => teams.acceptInvite(code),
    // The code is a credential: the finished mutation is not kept in the cache.
    gcTime: 0,
    onSuccess: async ({ team }) => {
      await refreshTeam(client, team.id);
    },
  });
}

export function useCreateInvite(teams: TeamsApi, teamId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => teams.createInvite(teamId),
    gcTime: 0,
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.teamInvites(teamId) });
    },
  });
}

export function useRevokeInvite(teams: TeamsApi, teamId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) => teams.revokeInvite(teamId, inviteId),
    onSettled: async () => {
      await client.invalidateQueries({ queryKey: queryKeys.teamInvites(teamId) });
    },
  });
}
