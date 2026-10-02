import { randomBytes } from 'node:crypto';

import { hashToken } from '@kadro/auth';
import {
  type AcceptInviteResponse,
  type CreateInviteRequest,
  type CreateInviteResponse,
  type InvitePreview,
  LIMITS,
  type Paginated,
  type PaginationQuery,
  type TeamInvite,
} from '@kadro/contracts';
import { teamInvites, teamMembers, teams } from '@kadro/db';
import { and, count, eq, gt, lt, sql } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { defineKeyset, openPage } from '../domain/pagination';
import { loadTeamRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { notifyMemberJoined } from '../jobs/notify';
import { mediaUrlBuilder } from '../uploads/urls';
import { actorIdOf, lockTeam, type TeamRequest } from './context';
import { loadTeamSummary, memberCountOf } from './projections';

/**
 * Team invites (ADR-0011, ADR-0034; authorization matrix §3.3 footnotes 7, 28, 29).
 *
 * - A code is 128 bits from the operating system CSPRNG, base64url (22 characters). Only its
 *   SHA-256 (`team_invites.code_hash`) is stored; the plaintext appears once, in the create
 *   response, and never in a list, a log line or an audit row.
 * - Preview and accept look a code up by hash in one indexed query whose condition already holds
 *   every validity rule (unexpired, not exhausted). An unknown, expired, revoked or exhausted code
 *   therefore costs the same work and yields the same 404, so neither the answer nor its timing
 *   tells a prober which state a code is in.
 * - Accept counts the use with a conditional increment under a lock on the team row, after the
 *   membership check, so an existing member never consumes a use and two concurrent accepts can
 *   never exceed `max_uses`.
 */

/** Staff list of a team's invites, newest first. */
const TEAM_INVITES = defineKeyset('teams.invites', [
  { column: teamInvites.createdAt, type: 'timestamp', direction: 'desc' },
  { column: teamInvites.id, type: 'uuid', direction: 'desc' },
]);

const INVITE_CODE_BYTES = 16;

/** A fresh invite code: 128 CSPRNG bits, base64url without padding (`LIMITS.inviteCode.length`). */
export function generateInviteCode(): string {
  return randomBytes(INVITE_CODE_BYTES).toString('base64url');
}

/** The only form in which a code reaches the database. */
export function inviteCodeHash(code: string): string {
  return hashToken(code);
}

/** Invite landing page (`/mac/[code]`, product spec §7), also the QR payload. */
export function inviteUrl(webOrigin: string, code: string): string {
  return new URL(`/mac/${encodeURIComponent(code)}`, webOrigin).toString();
}

/** Usable now: unexpired and not exhausted. */
function usableInvite(now: Date) {
  return and(gt(teamInvites.expiresAt, now), lt(teamInvites.uses, teamInvites.maxUses));
}

export async function createInvite(
  { ctx, runtime }: TeamRequest,
  teamId: string,
  body: CreateInviteRequest,
): Promise<CreateInviteResponse> {
  const actorId = actorIdOf(ctx);
  const code = generateInviteCode();
  const created = await runtime.db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const relation = await loadTeamRelation(tx, actorId, teamId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('invite.create', relation.facts);
    const now = runtime.now();
    const [live] = await tx
      .select({ invites: count() })
      .from(teamInvites)
      .where(and(eq(teamInvites.teamId, teamId), usableInvite(now)));
    if ((live?.invites ?? 0) >= LIMITS.activeInvitesPerTeam) {
      throw new ApiError('invite_limit');
    }
    const expiresAt = new Date(now.getTime() + body.expiresInSeconds * 1_000);
    const [invite] = await tx
      .insert(teamInvites)
      .values({
        teamId,
        codeHash: inviteCodeHash(code),
        expiresAt,
        maxUses: body.maxUses,
      })
      .returning({ id: teamInvites.id });
    if (invite === undefined) {
      throw new Error('invite insert returned no row');
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'invite.created',
      targetType: 'team_invite',
      targetId: invite.id,
      ip: ctx.ip,
      metadata: {
        teamId,
        maxUses: body.maxUses,
        expiresInSeconds: body.expiresInSeconds,
      },
    });
    return { inviteId: invite.id, expiresAt };
  });
  return {
    inviteId: created.inviteId,
    code,
    url: inviteUrl(runtime.env.WEB_ORIGIN, code),
    expiresAt: created.expiresAt.toISOString(),
    maxUses: body.maxUses,
  };
}

export async function listInvites(
  { ctx, runtime }: TeamRequest,
  teamId: string,
  query: PaginationQuery,
): Promise<Paginated<TeamInvite>> {
  const actorId = actorIdOf(ctx);
  const relation = await loadTeamRelation(runtime.db, actorId, teamId);
  if (relation === null) {
    throw new ApiError('not_found');
  }
  await ctx.authorize('invite.list', relation.facts);
  const page = openPage(
    TEAM_INVITES,
    { cursor: query.cursor, limit: query.limit, filters: { team: relation.teamId } },
    runtime.keyedHash,
  );
  const rows = await runtime.db
    .select({
      id: teamInvites.id,
      createdAt: teamInvites.createdAt,
      expiresAt: teamInvites.expiresAt,
      uses: teamInvites.uses,
      maxUses: teamInvites.maxUses,
      pageKey: page.key,
    })
    .from(teamInvites)
    .where(and(eq(teamInvites.teamId, relation.teamId), page.where))
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  return page.finish(rows, (row) => ({
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    uses: row.uses,
    maxUses: row.maxUses,
  }));
}

/**
 * `DELETE teams/:id/invites/:inviteId`: ends the invite now (`expires_at = now()`). The invite is
 * loaded inside the authorized team (`team_id = :id AND id = :inviteId`); an invite of another
 * team is a 404. Revoking an invite that is already over changes nothing and writes no audit row.
 */
export async function revokeInvite(
  { ctx, runtime }: TeamRequest,
  teamId: string,
  inviteId: string,
): Promise<void> {
  const actorId = actorIdOf(ctx);
  await runtime.db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const relation = await loadTeamRelation(tx, actorId, teamId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('invite.revoke', relation.facts);
    const now = runtime.now();
    const [invite] = await tx
      .select({ id: teamInvites.id, expiresAt: teamInvites.expiresAt })
      .from(teamInvites)
      .where(and(eq(teamInvites.id, inviteId), eq(teamInvites.teamId, relation.teamId)))
      .limit(1)
      .for('update');
    if (invite === undefined) {
      throw new ApiError('not_found');
    }
    if (invite.expiresAt.getTime() <= now.getTime()) {
      return;
    }
    await tx.update(teamInvites).set({ expiresAt: now }).where(eq(teamInvites.id, invite.id));
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'invite.revoked',
      targetType: 'team_invite',
      targetId: invite.id,
      ip: ctx.ip,
      metadata: { teamId: relation.teamId },
    });
  });
}

/**
 * `GET invites/:code` (anyone holding the code, group I): team name, badge, district and member
 * count only; no member or captain names (footnote 28).
 */
export async function previewInvite(
  { ctx, runtime }: TeamRequest,
  code: string,
): Promise<InvitePreview> {
  await ctx.authorize('invite.preview');
  const db = runtime.db;
  const [row] = await db
    .select({
      name: teams.name,
      badgeKey: teams.badgeKey,
      districtId: teams.districtId,
      memberCount: memberCountOf(db, teams.id),
    })
    .from(teamInvites)
    .innerJoin(teams, eq(teams.id, teamInvites.teamId))
    .where(and(eq(teamInvites.codeHash, inviteCodeHash(code)), usableInvite(runtime.now())))
    .limit(1);
  if (row === undefined) {
    throw new ApiError('not_found');
  }
  return {
    team: {
      name: row.name,
      badgeUrl: mediaUrlBuilder(runtime.env)(row.badgeKey),
      districtId: row.districtId,
      memberCount: row.memberCount,
    },
  };
}

/**
 * `POST invites/:code/accept` (verified email, group I). One transaction:
 *
 * 1. find the usable invite by code hash (else 404, whatever the reason);
 * 2. lock the team row, load the actor's membership, `can('invite.accept')`: an existing member
 *    gets 409 `already_participant` and no use is consumed; an unverified email gets 403;
 * 3. `uses = uses + 1 WHERE uses < max_uses AND expires_at > now`: zero rows (the last use went to
 *    a concurrent request, or the invite was revoked meanwhile) → the same 404;
 * 4. insert the membership as `player` and enqueue `team.member_joined` for the captain in the
 *    same transaction (ADR-0028, ADR-0031): a rolled-back accept leaves no job behind.
 */
export async function acceptInvite(
  { ctx, runtime }: TeamRequest,
  code: string,
): Promise<AcceptInviteResponse> {
  const actorId = actorIdOf(ctx);
  const codeHash = inviteCodeHash(code);
  return runtime.db.transaction(async (tx) => {
    const [invite] = await tx
      .select({ id: teamInvites.id, teamId: teamInvites.teamId })
      .from(teamInvites)
      .where(and(eq(teamInvites.codeHash, codeHash), usableInvite(runtime.now())))
      .limit(1);
    if (invite === undefined) {
      throw new ApiError('not_found');
    }
    await lockTeam(tx, invite.teamId);
    const relation = await loadTeamRelation(tx, actorId, invite.teamId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('invite.accept', relation.facts);
    const now = runtime.now();
    const [counted] = await tx
      .update(teamInvites)
      .set({ uses: sql`${teamInvites.uses} + 1` })
      .where(and(eq(teamInvites.id, invite.id), usableInvite(now)))
      .returning({ id: teamInvites.id });
    if (counted === undefined) {
      throw new ApiError('not_found');
    }
    const [membership] = await tx
      .insert(teamMembers)
      .values({ teamId: invite.teamId, userId: actorId, role: 'player', joinedAt: now })
      .returning({ id: teamMembers.id });
    if (membership === undefined) {
      throw new Error('membership insert returned no row');
    }
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'invite.accepted',
      targetType: 'team_invite',
      targetId: invite.id,
      ip: ctx.ip,
      metadata: { teamId: invite.teamId },
    });
    await notifyMemberJoined(runtime.jobs, tx, {
      teamId: invite.teamId,
      captainId: relation.ownerId,
      membershipId: membership.id,
    });
    const team = await loadTeamSummary(tx, invite.teamId, actorId, mediaUrlBuilder(runtime.env));
    if (team === null) {
      throw new Error('membership insert is not visible');
    }
    return { team };
  });
}
