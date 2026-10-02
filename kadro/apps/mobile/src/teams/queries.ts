import { queryOptions } from '@tanstack/react-query';

import { queryKeys } from '../query/keys';
import { type TeamsApi } from './teams-api';

/** Team with roster. Lives under the `teams` root, so the last copy is shown offline. */
export function teamDetailQuery(teams: TeamsApi, teamId: string) {
  return queryOptions({
    queryKey: queryKeys.teamDetail(teamId),
    queryFn: ({ signal }) => teams.getTeam(teamId, signal),
  });
}

/** Invite metadata for the team staff (never a code). Memory only. */
export function teamInvitesQuery(teams: TeamsApi, teamId: string) {
  return queryOptions({
    queryKey: queryKeys.teamInvites(teamId),
    queryFn: ({ signal }) => teams.listInvites(teamId, signal),
  });
}

/**
 * What an invite opens. The code is a credential (ADR-0011): the result is dropped as soon as no
 * screen shows it, and its root is outside the persisted allow-list.
 */
export function invitePreviewQuery(teams: TeamsApi, code: string) {
  return queryOptions({
    queryKey: queryKeys.invitePreview(code),
    queryFn: ({ signal }) => teams.previewInvite(code, signal),
    gcTime: 0,
    staleTime: 0,
  });
}
