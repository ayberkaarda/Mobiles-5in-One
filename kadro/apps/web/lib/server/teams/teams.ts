import { randomBytes } from 'node:crypto';

import {
  type CreateTeamRequest,
  foldTr,
  type MatchStatus,
  type Paginated,
  type PaginationQuery,
  type TeamDetail,
  type TeamSummary,
  type UpdateTeamRequest,
} from '@kadro/contracts';
import { matches, type NewTeam, teamMembers, teams, type Transaction, users } from '@kadro/db';
import { and, eq, exists, ne, sql } from 'drizzle-orm';

import { recordAudit } from '../audit';
import { defineKeyset, openPage } from '../domain/pagination';
import { loadTeamCreateFacts, loadTeamRelation } from '../domain/relations';
import { ApiError } from '../errors';
import { mediaUrlBuilder } from '../uploads/urls';
import { actorIdOf, lockTeam, type TeamRequest } from './context';
import {
  assertDistrictExists,
  loadTeamDetail,
  teamSummaryColumns,
  toTeamSummary,
} from './projections';

/**
 * Teams (product spec §3 story 2; authorization matrix §3.3, §4.2, §7). Every service follows
 * the handler template of matrix §2: rate limit, relationship facts loaded from the database,
 * `ctx.authorize()`, state checks, then the write in one transaction.
 */

/** `GET teams`: the actor's memberships, oldest first (ADR-0039 keyset on the membership index). */
const MY_TEAMS = defineKeyset('teams.mine', [
  { column: teamMembers.joinedAt, type: 'timestamp' },
  { column: teamMembers.teamId, type: 'uuid' },
]);

const SLUG_BASE_MAX = 40;

/**
 * Server-generated, immutable slug (matrix §4.2): the folded name in `[a-z0-9-]` plus 32 random
 * bits, so two teams with the same name never collide and the slug reveals no sequence.
 */
export function teamSlug(name: string): string {
  const base = foldTr(name)
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, SLUG_BASE_MAX)
    .replace(/^-+|-+$/g, '');
  const suffix = randomBytes(4).toString('hex');
  return `${base === '' ? 'kadro' : base}-${suffix}`;
}

export async function listTeams(
  { ctx, runtime }: TeamRequest,
  query: PaginationQuery,
): Promise<Paginated<TeamSummary>> {
  await ctx.authorize('team.list');
  const actorId = actorIdOf(ctx);
  const page = openPage(
    MY_TEAMS,
    { cursor: query.cursor, limit: query.limit, filters: { actor: actorId } },
    runtime.keyedHash,
  );
  const db = runtime.db;
  const rows = await db
    .select({ ...teamSummaryColumns(db), pageKey: page.key })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(and(eq(teamMembers.userId, actorId), page.where))
    .orderBy(...page.orderBy)
    .limit(page.fetchSize);
  const media = mediaUrlBuilder(runtime.env);
  return page.finish(rows, (row) => toTeamSummary(row, media));
}

/**
 * `POST teams`: the actor becomes captain and owner. The free-tier limit (one owned team,
 * footnote 6) is counted while holding a row lock on the actor's user row, so two concurrent
 * creates cannot both pass it.
 */
export async function createTeam(
  { ctx, runtime }: TeamRequest,
  body: CreateTeamRequest,
): Promise<TeamDetail> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, actorId)).for('update');
    await ctx.authorize('team.create', await loadTeamCreateFacts(tx, actorId));
    await assertDistrictExists(tx, body.districtId);
    const values: NewTeam = {
      name: body.name,
      slug: teamSlug(body.name),
      districtId: body.districtId,
      ownerId: actorId,
    };
    const [team] = await tx.insert(teams).values(values).returning({ id: teams.id });
    if (team === undefined) {
      throw new Error('team insert returned no row');
    }
    await tx
      .insert(teamMembers)
      .values({ teamId: team.id, userId: actorId, role: 'captain', joinedAt: runtime.now() });
    return loadTeamDetail(tx, team.id, actorId, mediaUrlBuilder(runtime.env));
  });
}

/** `GET teams/:id`: members only; everyone else gets the 404 of a missing id. */
export async function getTeam({ ctx, runtime }: TeamRequest, teamId: string): Promise<TeamDetail> {
  const actorId = actorIdOf(ctx);
  const relation = await loadTeamRelation(runtime.db, actorId, teamId);
  if (relation === null) {
    throw new ApiError('not_found');
  }
  await ctx.authorize('team.read', relation.facts);
  return loadTeamDetail(runtime.db, teamId, actorId, mediaUrlBuilder(runtime.env));
}

/**
 * `PATCH teams/:id` (captain, co-captain; not on a Pro-locked team). Only `name`, `districtId`
 * and `badge: null` are writable; `slug`, `owner_id`, `is_pro_locked` and `badge_key` are
 * server-only, and the strict request schema rejects them with 400 (matrix §4.2).
 */
export async function updateTeam(
  { ctx, runtime }: TeamRequest,
  teamId: string,
  body: UpdateTeamRequest,
): Promise<TeamDetail> {
  const actorId = actorIdOf(ctx);
  return runtime.db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const relation = await loadTeamRelation(tx, actorId, teamId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('team.update', relation.facts);
    const changes: Partial<Pick<NewTeam, 'name' | 'districtId' | 'badgeKey'>> = {};
    if (body.name !== undefined) {
      changes.name = body.name;
    }
    if (body.districtId !== undefined) {
      await assertDistrictExists(tx, body.districtId);
      changes.districtId = body.districtId;
    }
    if (body.badge === null) {
      changes.badgeKey = null;
    }
    if (Object.keys(changes).length > 0) {
      await tx.update(teams).set(changes).where(eq(teams.id, teamId));
    }
    return loadTeamDetail(tx, teamId, actorId, mediaUrlBuilder(runtime.env));
  });
}

/**
 * The match status that counts as team history for `DELETE teams/:id` (ADR-0032 step 3 note):
 * only `played`. `cancelled` matches are not history; a team with only cancelled matches is
 * deleted like a team without matches.
 */
const TEAM_HISTORY_MATCH_STATUS: MatchStatus = 'played';

/**
 * Whether the team has a `played` match and a member other than `captainId`, read in one query.
 * Callers hold `lockTeam`: every write that adds a member, creates a match or changes a match
 * status takes the same lock first (and a new `team_members` or `matches` row needs a key-share
 * lock on the team row), so the answer cannot change before the caller's transaction ends.
 */
async function hasSharedHistory(
  tx: Transaction,
  teamId: string,
  captainId: string,
): Promise<boolean> {
  const played = tx
    .select({ one: sql`1` })
    .from(matches)
    .where(and(eq(matches.teamId, teamId), eq(matches.status, TEAM_HISTORY_MATCH_STATUS)));
  const others = tx
    .select({ one: sql`1` })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, teamId), ne(teamMembers.userId, captainId)));
  const [row] = await tx
    .select({ shared: sql<boolean>`(${exists(played)} and ${exists(others)})` })
    .from(teams)
    .where(eq(teams.id, teamId));
  return row?.shared === true;
}

/**
 * `DELETE teams/:id` (captain only). A team that has a `played` match and any member besides the
 * captain is refused with 409 `team_has_history`: the captain transfers captaincy and leaves
 * instead, so other members keep the shared history. Otherwise memberships, invites, matches with
 * their RSVPs, votes and open calls, and pending badge uploads go with the team (foreign keys
 * `ON DELETE CASCADE`), as for a solo team in account deletion (ADR-0032 step 3). One audit row
 * without personal data records who deleted which team.
 */
export async function deleteTeam({ ctx, runtime }: TeamRequest, teamId: string): Promise<void> {
  const actorId = actorIdOf(ctx);
  await runtime.db.transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const relation = await loadTeamRelation(tx, actorId, teamId);
    if (relation === null) {
      throw new ApiError('not_found');
    }
    await ctx.authorize('team.delete', relation.facts);
    if (await hasSharedHistory(tx, teamId, actorId)) {
      throw new ApiError('team_has_history');
    }
    await tx.delete(teams).where(eq(teams.id, teamId));
    await recordAudit(tx, runtime.keyedHash, {
      actorId,
      action: 'team.deleted',
      targetType: 'team',
      targetId: teamId,
      ip: ctx.ip,
    });
  });
}
