import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';

import { api } from '../api/instance';
import { meQuery } from '../query';
import { teamsApi } from '../teams/instance';
import { teamDetailQuery } from '../teams/queries';
import { matchesApi } from './instance';
import { type ViewerRole } from './permissions';
import { matchDetailQuery } from './queries';

function param(value: string | string[] | undefined): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Data every match screen needs: the match (`GET matches/:id`), the viewer (`GET me`) and, for a
 * team member, the viewer's team role (from `GET teams/:id`; the match projection carries no
 * role). A guest has no role, so no staff control is ever offered to one. The role stays `null`
 * until the team has loaded, so staff controls appear only once the role is known.
 */
export function useMatchScreen({ enabled = true }: { readonly enabled?: boolean } = {}) {
  const params = useLocalSearchParams<{
    id?: string | string[];
    matchId?: string | string[];
  }>();
  const routeTeamId = param(params.id);
  const matchId = param(params.matchId);
  const query = useQuery({
    ...matchDetailQuery(matchesApi, matchId),
    enabled: enabled && matchId !== '',
  });
  const me = useQuery(meQuery(api));
  const match = query.data;
  const teamId = match?.team.id ?? routeTeamId;
  const isMember = match?.projection === 'member';
  const team = useQuery({ ...teamDetailQuery(teamsApi, teamId), enabled: isMember });
  const role: ViewerRole = isMember ? (team.data?.myRole ?? null) : null;
  return {
    matchId,
    teamId,
    query,
    match,
    myUserId: me.data?.id ?? null,
    role,
    roleLoading: isMember && team.data === undefined && team.status === 'pending',
  };
}
