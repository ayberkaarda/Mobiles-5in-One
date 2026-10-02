import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, sha256Hex, sha256HexCheck, timestamps, timestamptz } from './columns.js';
import { districts } from './districts.js';
import { teamRoleEnum } from './enums.js';
import { users } from './users.js';

export const teams = pgTable(
  'teams',
  {
    id: primaryId(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    badgeKey: text('badge_key'),
    districtId: uuid('district_id')
      .notNull()
      .references(() => districts.id, { onDelete: 'restrict' }),
    /** Always equals the `user_id` of the team's single `captain` member row. */
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    isProLocked: boolean('is_pro_locked').notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('teams_slug_key').on(t.slug),
    index('teams_owner_id_idx').on(t.ownerId),
    index('teams_district_id_idx').on(t.districtId),
    check('teams_name_length', sql`char_length(${t.name}) between 2 and 60`),
    check('teams_slug_format', sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: primaryId(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: teamRoleEnum('role').notNull().default('player'),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('team_members_team_id_user_id_key').on(t.teamId, t.userId),
    /** At most one captain per team; a captaincy transfer swaps roles inside one transaction. */
    uniqueIndex('team_members_one_captain_key')
      .on(t.teamId)
      .where(sql`${t.role} = 'captain'`),
    // Keyset order of `GET teams` for the actor (ADR-0039).
    index('team_members_user_id_joined_at_team_id_idx').on(t.userId, t.joinedAt, t.teamId),
  ],
);

/**
 * Team invite links. The invite code is shown to the inviter once and stored only as its SHA-256
 * hash; the accept flow and the invite landing page look codes up by hash.
 */
export const teamInvites = pgTable(
  'team_invites',
  {
    id: primaryId(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    codeHash: sha256Hex('code_hash').notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    maxUses: integer('max_uses').notNull(),
    uses: integer('uses').notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('team_invites_code_hash_key').on(t.codeHash),
    index('team_invites_team_id_idx').on(t.teamId),
    sha256HexCheck('team_invites_code_hash_format', t.codeHash),
    check('team_invites_max_uses_range', sql`${t.maxUses} between 1 and 50`),
    check('team_invites_uses_range', sql`${t.uses} between 0 and ${t.maxUses}`),
  ],
);
