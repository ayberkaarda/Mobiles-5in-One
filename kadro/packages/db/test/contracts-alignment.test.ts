import {
  LEVELS,
  LIMITS,
  foldTr,
  PLATFORM_ROLES,
  POSITIONS,
  PUSH_PLATFORMS as CONTRACT_PUSH_PLATFORMS,
  TEAM_ROLES as CONTRACT_TEAM_ROLES,
  UPLOAD_CONTENT_TYPES as CONTRACT_UPLOAD_CONTENT_TYPES,
  UPLOAD_KINDS as CONTRACT_UPLOAD_KINDS,
  UPLOAD_REJECT_REASONS as CONTRACT_UPLOAD_REJECT_REASONS,
  UPLOAD_STATUSES as CONTRACT_UPLOAD_STATUSES,
  MATCH_FORMATS as CONTRACT_MATCH_FORMATS,
  MATCH_STATUSES as CONTRACT_MATCH_STATUSES,
  RSVP_STATUSES as CONTRACT_RSVP_STATUSES,
  LINEUP_SIDES as CONTRACT_LINEUP_SIDES,
  OPEN_CALL_STATUSES as CONTRACT_OPEN_CALL_STATUSES,
  APPLICATION_STATUSES as CONTRACT_APPLICATION_STATUSES,
  AUTH_CLIENTS,
  idSchema,
} from '@kadro/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../src/client.js';
import {
  APPLICATION_STATUSES,
  LINEUP_SIDES,
  MATCH_FORMATS,
  MATCH_STATUSES,
  OPEN_CALL_STATUSES,
  RSVP_STATUSES,
  SESSION_CLIENTS,
  UPLOAD_CONTENT_TYPES,
  UPLOAD_KINDS,
  UPLOAD_REJECT_REASONS,
  UPLOAD_STATUSES,
  PLAYER_LEVELS,
  PLAYER_POSITIONS,
  PUSH_PLATFORMS,
  TEAM_ROLES,
  USER_ROLES,
  districts,
  matches,
  newId,
  pushTokens,
  refreshTokens,
  teamInvites,
  teams,
  users,
  venueReviews,
  venues,
} from '../src/schema/index.js';
import {
  PG_CHECK_VIOLATION,
  type TestDatabase,
  createMigratedDatabase,
  expectPgError,
  sha256Hex,
  uniqueSuffix,
} from './support.js';

describe('enums match @kadro/contracts', () => {
  it('uses the same value sets', () => {
    expect(PLAYER_LEVELS).toEqual(LEVELS);
    expect(PLAYER_POSITIONS).toEqual(POSITIONS);
    expect(USER_ROLES).toEqual(PLATFORM_ROLES);
    expect(TEAM_ROLES).toEqual(CONTRACT_TEAM_ROLES);
    expect(PUSH_PLATFORMS).toEqual(CONTRACT_PUSH_PLATFORMS);
    expect(SESSION_CLIENTS).toEqual(AUTH_CLIENTS);
    expect(MATCH_FORMATS).toEqual(CONTRACT_MATCH_FORMATS);
    expect(MATCH_STATUSES).toEqual(CONTRACT_MATCH_STATUSES);
    expect(RSVP_STATUSES).toEqual(CONTRACT_RSVP_STATUSES);
    expect(LINEUP_SIDES).toEqual(CONTRACT_LINEUP_SIDES);
    expect(OPEN_CALL_STATUSES).toEqual(CONTRACT_OPEN_CALL_STATUSES);
    expect(APPLICATION_STATUSES).toEqual(CONTRACT_APPLICATION_STATUSES);
    expect(UPLOAD_KINDS).toEqual(CONTRACT_UPLOAD_KINDS);
    expect(UPLOAD_CONTENT_TYPES).toEqual(CONTRACT_UPLOAD_CONTENT_TYPES);
    expect(UPLOAD_STATUSES).toEqual(CONTRACT_UPLOAD_STATUSES);
    expect(UPLOAD_REJECT_REASONS).toEqual(CONTRACT_UPLOAD_REJECT_REASONS);
  });

  it('generates ids accepted by the contracts id schema (UUIDv7)', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(idSchema.safeParse(newId()).success).toBe(true);
    }
  });
});

describe('check constraints match LIMITS at their boundaries', () => {
  let testDb: TestDatabase;
  let db: Database;
  let districtId: string;
  let userId: string;

  beforeAll(async () => {
    testDb = await createMigratedDatabase('kadro_alignment');
    db = testDb.client.db;
    const [district] = await db
      .insert(districts)
      .values({
        il: 'Sınır İl',
        ilce: 'Sınır İlçe',
        ilSlug: 'sinir-il',
        slug: 'sinir-ilce',
        centroid: { lng: 32.0, lat: 39.0 },
      })
      .returning({ id: districts.id });
    const [user] = await db
      .insert(users)
      .values({ email: `limits-${uniqueSuffix()}@example.test`, displayName: 'Sınır' })
      .returning({ id: users.id });
    if (!district || !user) throw new Error('fixture insert returned no row');
    districtId = district.id;
    userId = user.id;
  });

  afterAll(async () => {
    await testDb.dispose();
  });

  it('display name length', async () => {
    const insert = (length: number) =>
      db
        .insert(users)
        .values({ email: `dn-${uniqueSuffix()}@example.test`, displayName: 'a'.repeat(length) });
    await insert(LIMITS.displayName.min);
    await insert(LIMITS.displayName.max);
    await expectPgError(
      insert(LIMITS.displayName.min - 1),
      PG_CHECK_VIOLATION,
      'users_display_name_length',
    );
    await expectPgError(
      insert(LIMITS.displayName.max + 1),
      PG_CHECK_VIOLATION,
      'users_display_name_length',
    );
  });

  it('email length', async () => {
    const local = (length: number) => `${'a'.repeat(length - '@example.test'.length)}@example.test`;
    await db.insert(users).values({ email: local(LIMITS.email.max), displayName: 'Uzun' });
    await expectPgError(
      db.insert(users).values({ email: local(LIMITS.email.max + 1), displayName: 'Uzun' }),
      PG_CHECK_VIOLATION,
      'users_email_length',
    );
  });

  it('refresh token device label length', async () => {
    const insert = (length: number) =>
      db.insert(refreshTokens).values({
        tokenHash: sha256Hex(uniqueSuffix()),
        client: 'mobile',
        userId,
        familyId: newId(),
        expiresAt: new Date(Date.now() + 60_000),
        deviceLabel: 'd'.repeat(length),
      });
    await insert(LIMITS.deviceLabel.max);
    await expectPgError(
      insert(LIMITS.deviceLabel.max + 1),
      PG_CHECK_VIOLATION,
      'refresh_tokens_device_label_length',
    );
  });

  it('Expo push token length', async () => {
    const insert = (length: number) =>
      db.insert(pushTokens).values({ userId, expoToken: 'e'.repeat(length), platform: 'ios' });
    await insert(LIMITS.expoPushToken.max);
    await expectPgError(
      insert(LIMITS.expoPushToken.max + 1),
      PG_CHECK_VIOLATION,
      'push_tokens_expo_token_length',
    );
  });

  it('match fee and slots', async () => {
    const [team] = await db
      .insert(teams)
      .values({ name: 'Sınır Kadro', slug: `sinir-${uniqueSuffix()}`, districtId, ownerId: userId })
      .returning({ id: teams.id });
    if (!team) throw new Error('team insert returned no row');
    const insert = (feeTotalMinor: number, slots: number) =>
      db.insert(matches).values({
        teamId: team.id,
        startsAt: new Date(Date.now() + 86_400_000),
        format: '5v5',
        feeTotalMinor,
        slots,
      });
    await insert(LIMITS.feeTotalMinor.min, LIMITS.slots.min);
    await insert(LIMITS.feeTotalMinor.max, LIMITS.slots.max);
    await expectPgError(
      insert(LIMITS.feeTotalMinor.min - 1, LIMITS.slots.min),
      PG_CHECK_VIOLATION,
      'matches_fee_total_minor_range',
    );
    await expectPgError(
      insert(LIMITS.feeTotalMinor.max + 1, LIMITS.slots.min),
      PG_CHECK_VIOLATION,
      'matches_fee_total_minor_range',
    );
    await expectPgError(insert(0, LIMITS.slots.min - 1), PG_CHECK_VIOLATION, 'matches_slots_range');
    await expectPgError(insert(0, LIMITS.slots.max + 1), PG_CHECK_VIOLATION, 'matches_slots_range');
    await db.delete(teams).where(eq(teams.id, team.id));
  });

  it('invite max uses', async () => {
    const [team] = await db
      .insert(teams)
      .values({ name: 'Davet Kadro', slug: `davet-${uniqueSuffix()}`, districtId, ownerId: userId })
      .returning({ id: teams.id });
    if (!team) throw new Error('team insert returned no row');
    const insert = (maxUses: number) =>
      db.insert(teamInvites).values({
        teamId: team.id,
        codeHash: sha256Hex(uniqueSuffix()),
        expiresAt: new Date(Date.now() + 3_600_000),
        maxUses,
      });
    await insert(LIMITS.inviteMaxUses.min);
    await insert(LIMITS.inviteMaxUses.max);
    await expectPgError(
      insert(LIMITS.inviteMaxUses.min - 1),
      PG_CHECK_VIOLATION,
      'team_invites_max_uses_range',
    );
    await expectPgError(
      insert(LIMITS.inviteMaxUses.max + 1),
      PG_CHECK_VIOLATION,
      'team_invites_max_uses_range',
    );
  });

  it('review rating and text length', async () => {
    const [venue] = await db
      .insert(venues)
      .values({
        name: 'Sınır Saha',
        searchName: foldTr('Sınır Saha'),
        slug: `sinir-saha-${uniqueSuffix()}`,
        districtId,
        point: { lng: 32.0, lat: 39.0 },
      })
      .returning({ id: venues.id });
    if (!venue) throw new Error('venue insert returned no row');
    const reviewer = async (): Promise<string> => {
      const [row] = await db
        .insert(users)
        .values({ email: `rv-${uniqueSuffix()}@example.test`, displayName: 'Yorumcu' })
        .returning({ id: users.id });
      if (!row) throw new Error('user insert returned no row');
      return row.id;
    };
    const insert = async (rating: number, textLength: number) =>
      db.insert(venueReviews).values({
        venueId: venue.id,
        userId: await reviewer(),
        rating,
        text: 't'.repeat(textLength),
      });
    await insert(LIMITS.reviewRating.min, LIMITS.reviewText.max);
    await insert(LIMITS.reviewRating.max, 0);
    await expectPgError(
      insert(LIMITS.reviewRating.min - 1, 1),
      PG_CHECK_VIOLATION,
      'venue_reviews_rating_range',
    );
    await expectPgError(
      insert(LIMITS.reviewRating.max + 1, 1),
      PG_CHECK_VIOLATION,
      'venue_reviews_rating_range',
    );
    await expectPgError(
      insert(LIMITS.reviewRating.max, LIMITS.reviewText.max + 1),
      PG_CHECK_VIOLATION,
      'venue_reviews_text_length',
    );
  });
});
