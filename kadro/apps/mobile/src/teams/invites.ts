import { type TeamInvite } from '../api/contracts';

/**
 * Invites that still let someone join: not expired and with uses left. A revoked invite has its
 * `expiresAt` set to the revocation time (ADR-0034), so it drops out here too.
 */
export function activeInvites(
  invites: readonly TeamInvite[],
  now: number = Date.now(),
): TeamInvite[] {
  return invites.filter(
    (invite) => Date.parse(invite.expiresAt) > now && invite.uses < invite.maxUses,
  );
}
