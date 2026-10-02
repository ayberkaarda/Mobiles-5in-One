import {
  type TeamDetail,
  type TeamMember,
  type TeamRole,
  type TeamSummary,
} from '@kadro/contracts';
import { districts, teamMembers, teams, users } from '@kadro/db';
import { and, asc, count, eq, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { ApiError } from '../errors';
import { validationError } from '../validate';
import { type DbReader } from '../domain/relations';
import { type MediaUrlOf } from '../uploads/urls';

/**
 * Read projections of teams (authorization matrix §6): a summary with the actor's own role, the
 * roster as public cards (display name, avatar, position, level; never email or district), and
 * nothing else. Callers have already authorized the actor against the team.
 */

const rosterCount = alias(teamMembers, 'roster_count');

/** Number of members of the team whose id column is `teamId`, as a correlated subquery. */
export function memberCountOf(db: DbReader, teamId: SQL | typeof teams.id): SQL<number> {
  return sql<number>`(${db
    .select({ members: count() })
    .from(rosterCount)
    .where(eq(rosterCount.teamId, teamId))})`.mapWith(Number);
}

export interface TeamSummaryRow {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly badgeKey: string | null;
  readonly districtId: string;
  readonly myRole: TeamRole;
  readonly memberCount: number;
  readonly isProLocked: boolean;
  readonly createdAt: Date;
}

export function toTeamSummary(row: TeamSummaryRow, media: MediaUrlOf): TeamSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    badgeUrl: media(row.badgeKey),
    districtId: row.districtId,
    myRole: row.myRole,
    memberCount: row.memberCount,
    isProLocked: row.isProLocked,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Column set of a team summary, for selects joined to the actor's membership row. */
export function teamSummaryColumns(db: DbReader) {
  return {
    id: teams.id,
    name: teams.name,
    slug: teams.slug,
    badgeKey: teams.badgeKey,
    districtId: teams.districtId,
    myRole: teamMembers.role,
    memberCount: memberCountOf(db, teams.id),
    isProLocked: teams.isProLocked,
    createdAt: teams.createdAt,
  };
}

/** The team as seen by its member `actorId`; `null` when the actor is not (or no longer) a member. */
export async function loadTeamSummary(
  db: DbReader,
  teamId: string,
  actorId: string,
  media: MediaUrlOf,
): Promise<TeamSummary | null> {
  const [row] = await db
    .select(teamSummaryColumns(db))
    .from(teams)
    .innerJoin(teamMembers, and(eq(teamMembers.teamId, teams.id), eq(teamMembers.userId, actorId)))
    .where(eq(teams.id, teamId))
    .limit(1);
  return row === undefined ? null : toTeamSummary(row, media);
}

export interface MemberRow {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarKey: string | null;
  readonly position: TeamMember['user']['position'];
  readonly level: TeamMember['user']['level'];
  readonly role: TeamRole;
  readonly joinedAt: Date;
}

export function toTeamMember(row: MemberRow, media: MediaUrlOf): TeamMember {
  return {
    user: {
      id: row.userId,
      displayName: row.displayName,
      avatarUrl: media(row.avatarKey),
      position: row.position,
      level: row.level,
    },
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
  };
}

const MEMBER_COLUMNS = {
  userId: users.id,
  displayName: users.displayName,
  avatarKey: users.avatarKey,
  position: users.position,
  level: users.level,
  role: teamMembers.role,
  joinedAt: teamMembers.joinedAt,
};

/** Roster of the team, oldest membership first (ties by user id). */
export async function loadRoster(
  db: DbReader,
  teamId: string,
  media: MediaUrlOf,
): Promise<TeamMember[]> {
  const rows = await db
    .select(MEMBER_COLUMNS)
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(teamMembers.joinedAt), asc(users.id));
  return rows.map((row) => toTeamMember(row, media));
}

/** One roster entry; `null` when the user is not a member of the team. */
export async function loadMember(
  db: DbReader,
  teamId: string,
  userId: string,
  media: MediaUrlOf,
): Promise<TeamMember | null> {
  const [row] = await db
    .select(MEMBER_COLUMNS)
    .from(teamMembers)
    .innerJoin(users, eq(users.id, teamMembers.userId))
    .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)))
    .limit(1);
  return row === undefined ? null : toTeamMember(row, media);
}

/** Summary plus roster, as `GET teams/:id` and the create / update responses return it. */
export async function loadTeamDetail(
  db: DbReader,
  teamId: string,
  actorId: string,
  media: MediaUrlOf,
): Promise<TeamDetail> {
  const summary = await loadTeamSummary(db, teamId, actorId, media);
  if (summary === null) {
    // The caller authorized the actor as a member inside the same transaction or request.
    throw new ApiError('not_found');
  }
  return { ...summary, members: await loadRoster(db, teamId, media) };
}

/** `districtId` of a request body must reference an existing district (security checklist item 6). */
export async function assertDistrictExists(db: DbReader, districtId: string): Promise<void> {
  const [district] = await db
    .select({ id: districts.id })
    .from(districts)
    .where(eq(districts.id, districtId))
    .limit(1);
  if (district === undefined) {
    throw validationError('body', 'not_found', 'districtId');
  }
}
