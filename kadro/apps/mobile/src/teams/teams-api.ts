import { type ApiClient } from '../api/client';
import {
  type AcceptInviteResponse,
  type CreateInviteResponse,
  type CreateTeamRequest,
  type InvitePreview,
  type Paginated,
  type TeamDetail,
  type TeamInvite,
  type TeamMember,
  type TeamRole,
} from '../api/contracts';
import { isInviteCode } from './invite-code';

/** Page size of the invite list; a team holds at most 10 live invites (ADR-0034). */
export const INVITE_PAGE_SIZE = 50;

/**
 * Calls of the teams area (product spec §5, `packages/contracts` endpoints `getTeam` ..
 * `removeMember`). Every call goes through the shared client: bearer token, single-flight
 * refresh, problem details. Path segments are encoded; an invite code is shape-checked first, so
 * a malformed code never reaches the server (or its logs).
 */
export interface TeamsApi {
  getTeam(teamId: string, signal?: AbortSignal): Promise<TeamDetail>;
  createTeam(body: CreateTeamRequest): Promise<TeamDetail>;
  /** Server defaults apply: 7 days, 20 uses (ADR-0034). The code is in this response only. */
  createInvite(teamId: string): Promise<CreateInviteResponse>;
  listInvites(teamId: string, signal?: AbortSignal): Promise<Paginated<TeamInvite>>;
  revokeInvite(teamId: string, inviteId: string): Promise<void>;
  previewInvite(code: string, signal?: AbortSignal): Promise<InvitePreview>;
  acceptInvite(code: string): Promise<AcceptInviteResponse>;
  updateMemberRole(teamId: string, userId: string, role: TeamRole): Promise<TeamMember>;
  /** Removes another member, or leaves the team when `userId` is the caller. */
  removeMember(teamId: string, userId: string): Promise<void>;
}

function teamPath(teamId: string): string {
  return `/api/v1/teams/${encodeURIComponent(teamId)}`;
}

function invitePath(code: string): string {
  if (!isInviteCode(code)) {
    throw new TypeError('not an invite code');
  }
  return `/api/v1/invites/${code}`;
}

export function createTeamsApi(api: ApiClient): TeamsApi {
  return {
    getTeam: (teamId, signal) => api.request<TeamDetail>(teamPath(teamId), { signal }),
    createTeam: (body) =>
      api.request<TeamDetail>('/api/v1/teams', {
        method: 'POST',
        body: { name: body.name.trim(), districtId: body.districtId },
      }),
    createInvite: (teamId) =>
      api.request<CreateInviteResponse>(`${teamPath(teamId)}/invites`, {
        method: 'POST',
        body: {},
      }),
    listInvites: (teamId, signal) =>
      api.request<Paginated<TeamInvite>>(`${teamPath(teamId)}/invites`, {
        query: { limit: INVITE_PAGE_SIZE },
        signal,
      }),
    async revokeInvite(teamId, inviteId) {
      await api.request<unknown>(`${teamPath(teamId)}/invites/${encodeURIComponent(inviteId)}`, {
        method: 'DELETE',
      });
    },
    // Async, so a rejected code is a rejected promise like every other failure.
    async previewInvite(code, signal) {
      // Anonymous callers may preview too; a session is sent when there is one.
      return api.request<InvitePreview>(invitePath(code), { auth: 'optional', signal });
    },
    async acceptInvite(code) {
      return api.request<AcceptInviteResponse>(`${invitePath(code)}/accept`, {
        method: 'POST',
        body: {},
      });
    },
    updateMemberRole: (teamId, userId, role) =>
      api.request<TeamMember>(`${teamPath(teamId)}/members/${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        body: { role },
      }),
    async removeMember(teamId, userId) {
      await api.request<unknown>(`${teamPath(teamId)}/members/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
    },
  };
}
