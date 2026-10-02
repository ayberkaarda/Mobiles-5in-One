/**
 * Query key roots. The first key segment decides whether a query may be written to the device
 * cache (`persistence.ts`), so every query key starts with one of these roots.
 */
export const QUERY_ROOTS = {
  me: 'me',
  teams: 'teams',
  matches: 'matches',
  openCalls: 'open-calls',
  venues: 'venues',
  districts: 'districts',
  /** Invite metadata of a team (staff only): memory only, of no use offline. */
  teamInvites: 'team-invites',
  /** What an invite code opens; the key carries the code, so it is never written to the device. */
  invitePreview: 'invite-preview',
} as const;
export type QueryRoot = (typeof QUERY_ROOTS)[keyof typeof QUERY_ROOTS];

export const queryKeys = {
  me: () => [QUERY_ROOTS.me] as const,
  teams: () => [QUERY_ROOTS.teams, 'list'] as const,
  teamDetail: (teamId: string) => [QUERY_ROOTS.teams, 'detail', teamId] as const,
  teamInvites: (teamId: string) => [QUERY_ROOTS.teamInvites, teamId] as const,
  invitePreview: (code: string) => [QUERY_ROOTS.invitePreview, code] as const,
  teamMatches: (teamId: string) => [QUERY_ROOTS.matches, 'team', teamId] as const,
  openCalls: () => [QUERY_ROOTS.openCalls, 'list'] as const,
  venues: () => [QUERY_ROOTS.venues, 'list'] as const,
};
