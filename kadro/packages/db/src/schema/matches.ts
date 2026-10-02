import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { primaryId, timestamps, timestamptz } from './columns.js';
import { districts } from './districts.js';
import {
  applicationStatusEnum,
  lineupSideEnum,
  matchFormatEnum,
  matchStatusEnum,
  openCallStatusEnum,
  playerLevelEnum,
  playerPositionEnum,
  rsvpStatusEnum,
} from './enums.js';
import { teams } from './teams.js';
import { users } from './users.js';
import { venues } from './venues.js';

/**
 * Matches. `fee_total_minor` is in kuruş; the check mirrors security checklist item 6
 * (0..1 000 000.00 TRY) and `slots` 2..30 as a last line of defence behind API validation.
 */
export const matches = pgTable(
  'matches',
  {
    id: primaryId(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    venueId: uuid('venue_id').references(() => venues.id, { onDelete: 'set null' }),
    venueText: text('venue_text'),
    startsAt: timestamptz('starts_at').notNull(),
    format: matchFormatEnum('format').notNull(),
    feeTotalMinor: integer('fee_total_minor').notNull().default(0),
    slots: smallint('slots').notNull(),
    status: matchStatusEnum('status').notNull().default('draft'),
    /**
     * Set by the server on the first transition to `locked` and never cleared. Once set,
     * `fee_total_minor`, `slots` and `format` are frozen (ADR-0004, API conflict
     * `match_terms_frozen`), even if the match is re-opened.
     */
    lockedAt: timestamptz('locked_at'),
    mvpVoteClosesAt: timestamptz('mvp_vote_closes_at'),
    ...timestamps(),
  },
  (t) => [
    index('matches_team_id_starts_at_idx').on(t.teamId, t.startsAt),
    index('matches_venue_id_idx').on(t.venueId),
    index('matches_status_starts_at_idx').on(t.status, t.startsAt),
    check('matches_fee_total_minor_range', sql`${t.feeTotalMinor} between 0 and 100000000`),
    check('matches_slots_range', sql`${t.slots} between 2 and 30`),
    check('matches_venue_text_length', sql`char_length(${t.venueText}) <= 200`),
    check(
      'matches_locked_has_locked_at',
      sql`${t.status} <> 'locked' or ${t.lockedAt} is not null`,
    ),
  ],
);

export const matchRsvps = pgTable(
  'match_rsvps',
  {
    id: primaryId(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    /**
     * Restricted: account deletion re-points history rows to the tombstone of the deleted account
     * (ADR-0033) first.
     */
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    status: rsvpStatusEnum('status').notNull(),
    side: lineupSideEnum('side'),
    paid: boolean('paid').notNull().default(false),
    /** Queue position for `waitlist` rows (ADR-0035); promotion takes the oldest, ties by id. */
    waitlistedAt: timestamptz('waitlisted_at'),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('match_rsvps_match_id_user_id_key').on(t.matchId, t.userId),
    index('match_rsvps_user_id_idx').on(t.userId),
    index('match_rsvps_match_id_status_idx').on(t.matchId, t.status),
    index('match_rsvps_waitlist_idx')
      .on(t.matchId, t.waitlistedAt)
      .where(sql`${t.status} = 'waitlist'`),
    check(
      'match_rsvps_waitlisted_at_matches_status',
      sql`(${t.status} = 'waitlist') = (${t.waitlistedAt} is not null)`,
    ),
  ],
);

/**
 * MVP votes. Voter and votee are restricted: account deletion re-points both sides to the
 * tombstone of the deleted account (ADR-0033) first.
 */
export const mvpVotes = pgTable(
  'mvp_votes',
  {
    id: primaryId(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    voterId: uuid('voter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    voteeId: uuid('votee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('mvp_votes_match_id_voter_id_key').on(t.matchId, t.voterId),
    index('mvp_votes_match_id_votee_id_idx').on(t.matchId, t.voteeId),
    index('mvp_votes_voter_id_idx').on(t.voterId),
    index('mvp_votes_votee_id_idx').on(t.voteeId),
    check('mvp_votes_no_self_vote', sql`${t.voterId} <> ${t.voteeId}`),
  ],
);

/** "Eksik Var" open calls. A match has at most one call in status `open` at a time. */
export const openCalls = pgTable(
  'open_calls',
  {
    id: primaryId(),
    matchId: uuid('match_id')
      .notNull()
      .references(() => matches.id, { onDelete: 'cascade' }),
    missingCount: smallint('missing_count').notNull(),
    position: playerPositionEnum('position'),
    level: playerLevelEnum('level').notNull(),
    districtId: uuid('district_id')
      .notNull()
      .references(() => districts.id, { onDelete: 'restrict' }),
    status: openCallStatusEnum('status').notNull().default('open'),
    expiresAt: timestamptz('expires_at').notNull(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex('open_calls_one_open_per_match_key')
      .on(t.matchId)
      .where(sql`${t.status} = 'open'`),
    index('open_calls_match_id_idx').on(t.matchId),
    index('open_calls_district_id_status_expires_at_idx').on(t.districtId, t.status, t.expiresAt),
    check('open_calls_missing_count_range', sql`${t.missingCount} between 0 and 30`),
  ],
);

export const openCallApplications = pgTable(
  'open_call_applications',
  {
    id: primaryId(),
    openCallId: uuid('open_call_id')
      .notNull()
      .references(() => openCalls.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    message: text('message'),
    status: applicationStatusEnum('status').notNull().default('pending'),
    ...timestamps(),
  },
  (t) => [
    /** One application per user per call (authorization matrix footnote 20). */
    uniqueIndex('open_call_applications_open_call_id_user_id_key').on(t.openCallId, t.userId),
    index('open_call_applications_user_id_idx').on(t.userId),
    // Keyset order of application lists (ADR-0039).
    index('open_call_applications_open_call_id_created_at_id_idx').on(
      t.openCallId,
      t.createdAt,
      t.id,
    ),
    check('open_call_applications_message_length', sql`char_length(${t.message}) <= 280`),
  ],
);
