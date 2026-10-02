import { type TeamRole } from '../api/contracts';

/**
 * What the app offers to each team role (authorization matrix §3.3, ADR-0008, ADR-0034). These
 * only decide which controls are shown; the server enforces the same rules and its answer wins.
 */

/** Captain and co-captain see and revoke invites. */
export function canManageInvites(myRole: TeamRole): boolean {
  return myRole === 'captain' || myRole === 'co_captain';
}

/** Creating an invite also needs a team that is not read-only after a lapsed Pro plan. */
export function canCreateInvite(team: { myRole: TeamRole; isProLocked: boolean }): boolean {
  return canManageInvites(team.myRole) && !team.isProLocked;
}

/**
 * Roles the actor may give a member. Only the captain changes roles, never their own; `captain`
 * on another member is a captaincy transfer.
 */
export function roleChoices(
  actorRole: TeamRole,
  target: { role: TeamRole; isSelf: boolean },
): TeamRole[] {
  if (actorRole !== 'captain' || target.isSelf || target.role === 'captain') {
    return [];
  }
  const others: TeamRole[] = target.role === 'co_captain' ? ['player'] : ['co_captain'];
  return [...others, 'captain'];
}

/** Captain removes anyone else; co-captain removes players only; players remove nobody. */
export function canRemoveMember(
  actorRole: TeamRole,
  target: { role: TeamRole; isSelf: boolean },
): boolean {
  if (target.isSelf || target.role === 'captain') {
    return false;
  }
  if (actorRole === 'captain') {
    return true;
  }
  return actorRole === 'co_captain' && target.role === 'player';
}

/** The captain cannot leave before handing over the captaincy (409 `captain_must_transfer`). */
export function canLeave(myRole: TeamRole): boolean {
  return myRole !== 'captain';
}

/** Order of the roster: captain, co-captains, players. */
export const ROLE_ORDER: Readonly<Record<TeamRole, number>> = {
  captain: 0,
  co_captain: 1,
  player: 2,
};
