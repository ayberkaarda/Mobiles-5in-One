import { foldTr } from '@kadro/contracts';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../src/client.js';
import {
  districts,
  emailTokens,
  geographyPointSql,
  matches,
  matchRsvps,
  mvpVotes,
  openCallApplications,
  openCalls,
  pushTokens,
  refreshTokens,
  teamInvites,
  teamMembers,
  teams,
  users,
  venueReviews,
  venues,
  webhookEvents,
} from '../src/schema/index.js';
import {
  PG_CHECK_VIOLATION,
  PG_FOREIGN_KEY_VIOLATION,
  PG_UNIQUE_VIOLATION,
  type TestDatabase,
  createMigratedDatabase,
  expectPgError,
  sha256Hex,
  uniqueSuffix,
} from './support.js';

let testDb: TestDatabase;
let db: Database;
let districtId: string;

const ARGON2_HASH = '$argon2id$v=19$m=65536,t=3,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNoaGFzaA';

async function createUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({
      email: `player-${uniqueSuffix()}@example.test`,
      displayName: 'Test Oyuncu',
      passwordHash: ARGON2_HASH,
      ...overrides,
    })
    .returning({ id: users.id });
  if (!row) throw new Error('user insert returned no row');
  return row.id;
}

async function createTeam(ownerId: string): Promise<string> {
  const [row] = await db
    .insert(teams)
    .values({ name: 'Test Kadro', slug: `test-kadro-${uniqueSuffix()}`, districtId, ownerId })
    .returning({ id: teams.id });
  if (!row) throw new Error('team insert returned no row');
  await db.insert(teamMembers).values({ teamId: row.id, userId: ownerId, role: 'captain' });
  return row.id;
}

async function createMatch(teamId: string): Promise<string> {
  const [row] = await db
    .insert(matches)
    .values({
      teamId,
      venueText: 'Serbest metin saha',
      startsAt: new Date(Date.now() + 86_400_000),
      format: '7v7',
      feeTotalMinor: 280_000,
      slots: 14,
      status: 'open',
    })
    .returning({ id: matches.id });
  if (!row) throw new Error('match insert returned no row');
  return row.id;
}

async function createVenue(name = 'Test Saha'): Promise<string> {
  const [row] = await db
    .insert(venues)
    .values({
      name,
      searchName: foldTr(name),
      slug: `test-saha-${uniqueSuffix()}`,
      districtId,
      point: { lng: 29.03, lat: 40.99 },
    })
    .returning({ id: venues.id });
  if (!row) throw new Error('venue insert returned no row');
  return row.id;
}

beforeAll(async () => {
  testDb = await createMigratedDatabase('kadro_constraints');
  db = testDb.client.db;
  const [district] = await db
    .insert(districts)
    .values({
      il: 'Test İl',
      ilce: 'Test İlçe',
      ilSlug: 'test-il',
      slug: 'test-ilce',
      centroid: { lng: 29.0, lat: 41.0 },
    })
    .returning({ id: districts.id });
  if (!district) throw new Error('district insert returned no row');
  districtId = district.id;
});

afterAll(async () => {
  await testDb.dispose();
});

describe('ids and timestamps', () => {
  it('generates UUIDv7 ids in the application', async () => {
    const id = await createUser();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('refreshes updated_at on update', async () => {
    const id = await createUser();
    const [before] = await db.select().from(users).where(eq(users.id, id));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await db.update(users).set({ displayName: 'Yeni İsim' }).where(eq(users.id, id));
    const [after] = await db.select().from(users).where(eq(users.id, id));
    expect(after?.updatedAt.getTime()).toBeGreaterThan(before?.updatedAt.getTime() ?? Infinity);
    expect(after?.createdAt.getTime()).toBe(before?.createdAt.getTime());
  });
});

describe('users', () => {
  it('rejects a second account with the same email in any letter case', async () => {
    const email = `case-${uniqueSuffix()}@example.test`;
    await createUser({ email });
    await expectPgError(
      createUser({ email: email.toUpperCase() }),
      PG_UNIQUE_VIOLATION,
      'users_email_lower_key',
    );
  });

  it('rejects duplicate Apple and Google subjects', async () => {
    const appleSub = `apple-${uniqueSuffix()}`;
    const googleSub = `google-${uniqueSuffix()}`;
    await createUser({ appleSub, googleSub });
    await expectPgError(createUser({ appleSub }), PG_UNIQUE_VIOLATION, 'users_apple_sub_key');
    await expectPgError(createUser({ googleSub }), PG_UNIQUE_VIOLATION, 'users_google_sub_key');
  });

  it('accepts only Argon2id password hashes', async () => {
    await expectPgError(
      createUser({ passwordHash: 'plain-text-password' }),
      PG_CHECK_VIOLATION,
      'users_password_hash_argon2id',
    );
    await expect(createUser({ passwordHash: null })).resolves.toBeTypeOf('string');
  });

  it('rejects an unknown district', async () => {
    await expectPgError(
      createUser({ districtId: '01890000-0000-7000-8000-000000000000' }),
      PG_FOREIGN_KEY_VIOLATION,
      'users_district_id_districts_id_fk',
    );
  });
});

describe('refresh and email tokens', () => {
  it('stores refresh tokens by unique SHA-256 hash and rejects plaintext values', async () => {
    const userId = await createUser();
    const tokenHash = sha256Hex(`refresh-${uniqueSuffix()}`);
    const familyId = '01890000-0000-7000-8000-0000000000aa';
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    await db
      .insert(refreshTokens)
      .values({ tokenHash, client: 'mobile', userId, familyId, expiresAt });
    await expectPgError(
      db.insert(refreshTokens).values({ tokenHash, client: 'mobile', userId, familyId, expiresAt }),
      PG_UNIQUE_VIOLATION,
      'refresh_tokens_token_hash_key',
    );
    await expectPgError(
      db
        .insert(refreshTokens)
        .values({ tokenHash: 'x'.repeat(64), client: 'mobile', userId, familyId, expiresAt }),
      PG_CHECK_VIOLATION,
      'refresh_tokens_token_hash_format',
    );
  });

  it('links rotations through rotated_from and cascades on user deletion', async () => {
    const userId = await createUser();
    const familyId = '01890000-0000-7000-8000-0000000000bb';
    const expiresAt = new Date(Date.now() + 86_400_000);
    const [first] = await db
      .insert(refreshTokens)
      .values({
        tokenHash: sha256Hex(uniqueSuffix()),
        client: 'mobile',
        userId,
        familyId,
        expiresAt,
      })
      .returning({ id: refreshTokens.id });
    await db.insert(refreshTokens).values({
      tokenHash: sha256Hex(uniqueSuffix()),
      client: 'mobile',
      userId,
      familyId,
      expiresAt,
      rotatedFrom: first?.id,
    });
    await db.delete(users).where(eq(users.id, userId));
    const remaining = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.familyId, familyId));
    expect(remaining).toEqual([]);
  });

  it('keeps web session cookies in refresh_tokens with the same family revocation', async () => {
    const userId = await createUser();
    const familyId = '01890000-0000-7000-8000-0000000000cc';
    const expiresAt = new Date(Date.now() + 7 * 86_400_000);
    const [first] = await db
      .insert(refreshTokens)
      .values({ tokenHash: sha256Hex(uniqueSuffix()), client: 'web', userId, familyId, expiresAt })
      .returning({ id: refreshTokens.id });
    await db.insert(refreshTokens).values({
      tokenHash: sha256Hex(uniqueSuffix()),
      client: 'web',
      userId,
      familyId,
      expiresAt,
      rotatedFrom: first?.id,
    });
    await db.insert(refreshTokens).values({
      tokenHash: sha256Hex(uniqueSuffix()),
      client: 'mobile',
      userId,
      familyId: '01890000-0000-7000-8000-0000000000cd',
      expiresAt,
    });

    const revoked = await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.familyId, familyId))
      .returning({ client: refreshTokens.client });
    expect(revoked).toEqual([{ client: 'web' }, { client: 'web' }]);
    const webRows = await db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(and(eq(refreshTokens.userId, userId), eq(refreshTokens.client, 'web')));
    expect(webRows).toHaveLength(2);
  });

  it('requires a known client kind on every refresh token row', async () => {
    const userId = await createUser();
    const insert = async () =>
      db.insert(refreshTokens).values({
        tokenHash: sha256Hex(uniqueSuffix()),
        client: 'desktop' as 'web',
        userId,
        familyId: '01890000-0000-7000-8000-0000000000ce',
        expiresAt: new Date(Date.now() + 60_000),
      });
    await expectPgError(insert(), '22P02');
  });

  it('stores email tokens by unique hash and requires an existing user', async () => {
    const userId = await createUser();
    const tokenHash = sha256Hex(`email-${uniqueSuffix()}`);
    const expiresAt = new Date(Date.now() + 3_600_000);
    await db.insert(emailTokens).values({ userId, purpose: 'verify', tokenHash, expiresAt });
    await expectPgError(
      db.insert(emailTokens).values({ userId, purpose: 'reset', tokenHash, expiresAt }),
      PG_UNIQUE_VIOLATION,
      'email_tokens_token_hash_key',
    );
    await expectPgError(
      db.insert(emailTokens).values({
        userId: '01890000-0000-7000-8000-000000000001',
        purpose: 'verify',
        tokenHash: sha256Hex(uniqueSuffix()),
        expiresAt,
      }),
      PG_FOREIGN_KEY_VIOLATION,
    );
  });
});

describe('teams', () => {
  it('allows one membership per user per team and one captain per team', async () => {
    const captain = await createUser();
    const other = await createUser();
    const teamId = await createTeam(captain);
    await expectPgError(
      db.insert(teamMembers).values({ teamId, userId: captain, role: 'player' }),
      PG_UNIQUE_VIOLATION,
      'team_members_team_id_user_id_key',
    );
    await expectPgError(
      db.insert(teamMembers).values({ teamId, userId: other, role: 'captain' }),
      PG_UNIQUE_VIOLATION,
      'team_members_one_captain_key',
    );
    await expect(
      db.insert(teamMembers).values({ teamId, userId: other, role: 'co_captain' }),
    ).resolves.toBeDefined();
  });

  it('keeps the owner from being deleted while the team exists and cascades team deletion', async () => {
    const captain = await createUser();
    const teamId = await createTeam(captain);
    await expectPgError(
      db.delete(users).where(eq(users.id, captain)),
      PG_FOREIGN_KEY_VIOLATION,
      'teams_owner_id_users_id_fk',
    );
    await db.delete(teams).where(eq(teams.id, teamId));
    const members = await db.select().from(teamMembers).where(eq(teamMembers.teamId, teamId));
    expect(members).toEqual([]);
  });

  it('stores invite codes only as unique hashes with bounded uses', async () => {
    const teamId = await createTeam(await createUser());
    const codeHash = sha256Hex(`invite-${uniqueSuffix()}`);
    const expiresAt = new Date(Date.now() + 86_400_000);
    await db.insert(teamInvites).values({ teamId, codeHash, expiresAt, maxUses: 5 });
    await expectPgError(
      db.insert(teamInvites).values({ teamId, codeHash, expiresAt, maxUses: 5 }),
      PG_UNIQUE_VIOLATION,
      'team_invites_code_hash_key',
    );
    await expectPgError(
      db
        .insert(teamInvites)
        .values({ teamId, codeHash: sha256Hex(uniqueSuffix()), expiresAt, maxUses: 2, uses: 3 }),
      PG_CHECK_VIOLATION,
      'team_invites_uses_range',
    );
    await expectPgError(
      db
        .insert(teamInvites)
        .values({ teamId, codeHash: sha256Hex(uniqueSuffix()), expiresAt, maxUses: 51 }),
      PG_CHECK_VIOLATION,
      'team_invites_max_uses_range',
    );
  });

  it('increments invite uses atomically only while below max_uses', async () => {
    const teamId = await createTeam(await createUser());
    const codeHash = sha256Hex(`invite-${uniqueSuffix()}`);
    await db
      .insert(teamInvites)
      .values({ teamId, codeHash, expiresAt: new Date(Date.now() + 86_400_000), maxUses: 1 });
    const accept = () =>
      db
        .update(teamInvites)
        .set({ uses: sql`${teamInvites.uses} + 1` })
        .where(
          and(
            eq(teamInvites.codeHash, codeHash),
            sql`${teamInvites.uses} < ${teamInvites.maxUses}`,
          ),
        )
        .returning({ uses: teamInvites.uses });
    expect(await accept()).toEqual([{ uses: 1 }]);
    expect(await accept()).toEqual([]);
  });
});

describe('matches', () => {
  it('enforces slot and fee ranges', async () => {
    const teamId = await createTeam(await createUser());
    const base = {
      teamId,
      startsAt: new Date(Date.now() + 86_400_000),
      format: '6v6' as const,
    };
    await expectPgError(
      db.insert(matches).values({ ...base, slots: 31 }),
      PG_CHECK_VIOLATION,
      'matches_slots_range',
    );
    await expectPgError(
      db.insert(matches).values({ ...base, slots: 12, feeTotalMinor: 100_000_001 }),
      PG_CHECK_VIOLATION,
      'matches_fee_total_minor_range',
    );
  });

  it('requires locked_at for locked matches', async () => {
    const matchId = await createMatch(await createTeam(await createUser()));
    await expectPgError(
      db.update(matches).set({ status: 'locked' }).where(eq(matches.id, matchId)),
      PG_CHECK_VIOLATION,
      'matches_locked_has_locked_at',
    );
  });

  it('freezes fee, slots and format after the first lock, even when re-opened', async () => {
    const matchId = await createMatch(await createTeam(await createUser()));
    await db
      .update(matches)
      .set({ feeTotalMinor: 300_000, slots: 12 })
      .where(eq(matches.id, matchId));
    await db
      .update(matches)
      .set({ status: 'locked', lockedAt: new Date() })
      .where(eq(matches.id, matchId));
    await db.update(matches).set({ status: 'open' }).where(eq(matches.id, matchId));

    for (const change of [
      { feeTotalMinor: 1 },
      { slots: 10 },
      { format: '8v8' as const },
      { lockedAt: null },
    ]) {
      await expectPgError(
        db.update(matches).set(change).where(eq(matches.id, matchId)),
        PG_CHECK_VIOLATION,
        'matches_terms_frozen',
      );
    }
    const later = new Date(Date.now() + 2 * 86_400_000);
    await db
      .update(matches)
      .set({ startsAt: later, venueText: 'Yeni saha' })
      .where(eq(matches.id, matchId));
    const [row] = await db.select().from(matches).where(eq(matches.id, matchId));
    expect(row).toMatchObject({ feeTotalMinor: 300_000, slots: 12, format: '7v7', status: 'open' });
    expect(row?.lockedAt).toBeInstanceOf(Date);
  });

  it('allows one RSVP per user per match and keeps RSVP history when a user is deleted', async () => {
    const captain = await createUser();
    const matchId = await createMatch(await createTeam(captain));
    const player = await createUser();
    await db.insert(matchRsvps).values({ matchId, userId: player, status: 'in' });
    await expectPgError(
      db.insert(matchRsvps).values({ matchId, userId: player, status: 'maybe' }),
      PG_UNIQUE_VIOLATION,
      'match_rsvps_match_id_user_id_key',
    );
    await expectPgError(
      db.delete(users).where(eq(users.id, player)),
      PG_FOREIGN_KEY_VIOLATION,
      'match_rsvps_user_id_users_id_fk',
    );
  });

  it('accepts one MVP vote per voter per match and no self votes', async () => {
    const captain = await createUser();
    const matchId = await createMatch(await createTeam(captain));
    const votee = await createUser();
    const other = await createUser();
    await db.insert(mvpVotes).values({ matchId, voterId: captain, voteeId: votee });
    await expectPgError(
      db.insert(mvpVotes).values({ matchId, voterId: captain, voteeId: other }),
      PG_UNIQUE_VIOLATION,
      'mvp_votes_match_id_voter_id_key',
    );
    await expectPgError(
      db.insert(mvpVotes).values({ matchId, voterId: other, voteeId: other }),
      PG_CHECK_VIOLATION,
      'mvp_votes_no_self_vote',
    );
  });
});

describe('open calls', () => {
  it('allows one open call per match and one application per user per call', async () => {
    const matchId = await createMatch(await createTeam(await createUser()));
    const expiresAt = new Date(Date.now() + 3_600_000);
    const [call] = await db
      .insert(openCalls)
      .values({ matchId, missingCount: 2, level: 'regular', districtId, expiresAt })
      .returning({ id: openCalls.id });
    if (!call) throw new Error('open call insert returned no row');
    await expectPgError(
      db
        .insert(openCalls)
        .values({ matchId, missingCount: 1, level: 'casual', districtId, expiresAt }),
      PG_UNIQUE_VIOLATION,
      'open_calls_one_open_per_match_key',
    );
    await expect(
      db.insert(openCalls).values({
        matchId,
        missingCount: 1,
        level: 'casual',
        districtId,
        expiresAt,
        status: 'closed',
      }),
    ).resolves.toBeDefined();

    const applicant = await createUser();
    await db
      .insert(openCallApplications)
      .values({ openCallId: call.id, userId: applicant, message: 'Kaleci olarak gelebilirim.' });
    await expectPgError(
      db.insert(openCallApplications).values({ openCallId: call.id, userId: applicant }),
      PG_UNIQUE_VIOLATION,
      'open_call_applications_open_call_id_user_id_key',
    );
    await expectPgError(
      db
        .insert(openCallApplications)
        .values({ openCallId: call.id, userId: await createUser(), message: 'x'.repeat(281) }),
      PG_CHECK_VIOLATION,
      'open_call_applications_message_length',
    );
  });
});

describe('venues', () => {
  it('requires the [ÖRNEK] prefix on sample venues', async () => {
    await expectPgError(
      db.insert(venues).values({
        name: 'Gerçek Görünen Saha',
        searchName: foldTr('Gerçek Görünen Saha'),
        slug: `sample-${uniqueSuffix()}`,
        districtId,
        point: { lng: 29.0, lat: 41.0 },
        isSample: true,
      }),
      PG_CHECK_VIOLATION,
      'venues_sample_name_prefix',
    );
  });

  it('rejects an inverted price range', async () => {
    await expectPgError(
      db.insert(venues).values({
        name: 'Fiyat Testi',
        searchName: foldTr('Fiyat Testi'),
        slug: `price-${uniqueSuffix()}`,
        districtId,
        point: { lng: 29.0, lat: 41.0 },
        priceMinMinor: 500,
        priceMaxMinor: 100,
      }),
      PG_CHECK_VIOLATION,
      'venues_price_range',
    );
  });

  it('allows one review per user per venue with a 1..5 rating', async () => {
    const venueId = await createVenue();
    const userId = await createUser();
    await db.insert(venueReviews).values({ venueId, userId, rating: 4, text: 'Zemin iyi.' });
    await expectPgError(
      db.insert(venueReviews).values({ venueId, userId, rating: 5 }),
      PG_UNIQUE_VIOLATION,
      'venue_reviews_venue_id_user_id_key',
    );
    await expectPgError(
      db.insert(venueReviews).values({ venueId, userId: await createUser(), rating: 6 }),
      PG_CHECK_VIOLATION,
      'venue_reviews_rating_range',
    );
  });

  it('round-trips geography points and supports bound-parameter distance queries', async () => {
    const venueId = await createVenue();
    const [row] = await db
      .select({ point: venues.point })
      .from(venues)
      .where(eq(venues.id, venueId));
    expect(row?.point).toEqual({ lng: 29.03, lat: 40.99 });

    const nearby = await db
      .select({ id: venues.id })
      .from(venues)
      .where(
        and(
          eq(venues.id, venueId),
          sql`ST_DWithin(${venues.point}, ${geographyPointSql({ lng: 29.031, lat: 40.991 })}, ${500})`,
        ),
      );
    expect(nearby).toEqual([{ id: venueId }]);

    const far = await db
      .select({ id: venues.id })
      .from(venues)
      .where(
        and(
          eq(venues.id, venueId),
          sql`ST_DWithin(${venues.point}, ${geographyPointSql({ lng: 32.86, lat: 39.9 })}, ${500})`,
        ),
      );
    expect(far).toEqual([]);
  });

  it('rejects out-of-range coordinates before they reach the database', async () => {
    const insert = async () =>
      db.insert(venues).values({
        name: 'Koordinat Testi',
        searchName: foldTr('Koordinat Testi'),
        slug: `coord-${uniqueSuffix()}`,
        districtId,
        point: { lng: 200, lat: 41 },
      });
    await expect(insert()).rejects.toThrow(RangeError);
  });
});

describe('push tokens and webhooks', () => {
  it('binds an Expo push token to a single user', async () => {
    const expoToken = `ExponentPushToken[${uniqueSuffix()}]`;
    await db.insert(pushTokens).values({ userId: await createUser(), expoToken, platform: 'ios' });
    await expectPgError(
      db.insert(pushTokens).values({ userId: await createUser(), expoToken, platform: 'android' }),
      PG_UNIQUE_VIOLATION,
      'push_tokens_expo_token_key',
    );
  });

  it('rejects a replayed webhook event id', async () => {
    const eventId = `evt-${uniqueSuffix()}`;
    const payloadHash = sha256Hex(eventId);
    await db.insert(webhookEvents).values({ provider: 'revenuecat', eventId, payloadHash });
    await expectPgError(
      db.insert(webhookEvents).values({ provider: 'revenuecat', eventId, payloadHash }),
      PG_UNIQUE_VIOLATION,
      'webhook_events_provider_event_id_key',
    );
  });
});
