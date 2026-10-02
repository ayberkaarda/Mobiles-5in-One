import { LIMITS, foldTr } from '@kadro/contracts';
import { and, asc, eq, sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Database } from '../src/client.js';
import { MIGRATIONS_FOLDER, runMigrations } from '../src/migrate.js';
import {
  deletionRequests,
  districts,
  jobReceipts,
  matches,
  matchRsvps,
  newId,
  teams,
  uploads,
  users,
  venues,
} from '../src/schema/index.js';
import { seedDatabase } from '../src/seed/index.js';
import {
  PG_CHECK_VIOLATION,
  PG_INSUFFICIENT_PRIVILEGE,
  PG_UNIQUE_VIOLATION,
  type TestDatabase,
  createEmptyDatabase,
  createMigratedDatabase,
  expectPgError,
  uniqueSuffix,
} from './support.js';

const PG_UNDEFINED_TABLE = '42P01';

let testDb: TestDatabase;
let db: Database;
let districtId: string;

async function createUser(overrides: Partial<typeof users.$inferInsert> = {}): Promise<string> {
  const [row] = await db
    .insert(users)
    .values({ email: `p2-${uniqueSuffix()}@example.test`, displayName: 'Faz İki', ...overrides })
    .returning({ id: users.id });
  if (!row) throw new Error('user insert returned no row');
  return row.id;
}

async function createTeam(ownerId: string): Promise<string> {
  const [row] = await db
    .insert(teams)
    .values({ name: 'Faz Kadro', slug: `faz-${uniqueSuffix()}`, districtId, ownerId })
    .returning({ id: teams.id });
  if (!row) throw new Error('team insert returned no row');
  return row.id;
}

async function createMatch(teamId: string): Promise<string> {
  const [row] = await db
    .insert(matches)
    .values({
      teamId,
      startsAt: new Date(Date.now() + 86_400_000),
      format: '6v6',
      slots: 12,
      status: 'open',
    })
    .returning({ id: matches.id });
  if (!row) throw new Error('match insert returned no row');
  return row.id;
}

beforeAll(async () => {
  testDb = await createMigratedDatabase('kadro_phase2');
  db = testDb.client.db;
  const [district] = await db
    .insert(districts)
    .values({
      il: 'Faz İl',
      ilce: 'Faz İlçe',
      ilSlug: 'faz-il',
      slug: 'faz-ilce',
      centroid: { lng: 27.1, lat: 38.4 },
    })
    .returning({ id: districts.id });
  if (!district) throw new Error('district insert returned no row');
  districtId = district.id;
});

afterAll(async () => {
  await testDb.dispose();
});

describe('job_receipts (ADR-0028)', () => {
  it('accepts a receipt once per queue and idempotency key', async () => {
    const idempotencyKey = `upload:${newId()}`;
    await db.insert(jobReceipts).values({ queue: 'upload.process', idempotencyKey });
    await expectPgError(
      db.insert(jobReceipts).values({ queue: 'upload.process', idempotencyKey }),
      PG_UNIQUE_VIOLATION,
      'job_receipts_queue_idempotency_key_key',
    );
    await expect(
      db.insert(jobReceipts).values({ queue: 'email.send', idempotencyKey }),
    ).resolves.toBeDefined();
  });

  it('limits the idempotency key to 128 characters', async () => {
    await db.insert(jobReceipts).values({ queue: 'push.send', idempotencyKey: 'k'.repeat(128) });
    await expectPgError(
      db.insert(jobReceipts).values({ queue: 'push.send', idempotencyKey: 'k'.repeat(129) }),
      PG_CHECK_VIOLATION,
      'job_receipts_idempotency_key_length',
    );
  });
});

describe('uploads (ADR-0030)', () => {
  function avatar(userId: string, overrides: Partial<typeof uploads.$inferInsert> = {}) {
    const id = newId();
    return {
      id,
      userId,
      kind: 'avatar' as const,
      contentType: 'image/png' as const,
      contentLength: 1024,
      key: `avatars/${userId}/${id}`,
      ...overrides,
    };
  }

  it('stores avatar and badge uploads under server-derived keys', async () => {
    const userId = await createUser();
    const teamId = await createTeam(userId);
    await db.insert(uploads).values(avatar(userId));
    const badgeId = newId();
    await db.insert(uploads).values({
      id: badgeId,
      userId,
      kind: 'badge',
      teamId,
      contentType: 'image/webp',
      contentLength: LIMITS.uploadBytes.max,
      key: `badges/${teamId}/${badgeId}`,
    });
    await expectPgError(
      db.insert(uploads).values(avatar(userId, { key: `avatars/${newId()}/${newId()}` })),
      PG_CHECK_VIOLATION,
      'uploads_key_matches_owner',
    );
  });

  it('requires a team exactly for badges', async () => {
    const userId = await createUser();
    const teamId = await createTeam(userId);
    const id = newId();
    await expectPgError(
      db.insert(uploads).values({
        id,
        userId,
        kind: 'badge',
        contentType: 'image/jpeg',
        contentLength: 10,
        key: `badges/${teamId}/${id}`,
      }),
      PG_CHECK_VIOLATION,
      'uploads_badge_has_team',
    );
    await expectPgError(
      db.insert(uploads).values(avatar(userId, { teamId })),
      PG_CHECK_VIOLATION,
      'uploads_badge_has_team',
    );
  });

  it('requires a reject reason exactly for rejected uploads', async () => {
    const userId = await createUser();
    await expectPgError(
      db.insert(uploads).values(avatar(userId, { status: 'rejected' })),
      PG_CHECK_VIOLATION,
      'uploads_rejected_has_reason',
    );
    await expectPgError(
      db.insert(uploads).values(avatar(userId, { status: 'ready', rejectReason: 'missing' })),
      PG_CHECK_VIOLATION,
      'uploads_rejected_has_reason',
    );
    await expect(
      db
        .insert(uploads)
        .values(avatar(userId, { status: 'rejected', rejectReason: 'too_many_pixels' })),
    ).resolves.toBeDefined();
  });

  it('bounds the declared size to LIMITS.uploadBytes', async () => {
    const userId = await createUser();
    await db.insert(uploads).values(avatar(userId, { contentLength: LIMITS.uploadBytes.min }));
    for (const contentLength of [LIMITS.uploadBytes.min - 1, LIMITS.uploadBytes.max + 1]) {
      await expectPgError(
        db.insert(uploads).values(avatar(userId, { contentLength })),
        PG_CHECK_VIOLATION,
        'uploads_content_length_range',
      );
    }
  });

  it('cascades with the uploader and with the badge team', async () => {
    const userId = await createUser();
    const owner = await createUser();
    const teamId = await createTeam(owner);
    const badgeId = newId();
    await db.insert(uploads).values([
      avatar(userId),
      {
        id: badgeId,
        userId: owner,
        kind: 'badge',
        teamId,
        contentType: 'image/png',
        contentLength: 99,
        key: `badges/${teamId}/${badgeId}`,
      },
    ]);
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(uploads).where(eq(uploads.userId, userId))).toEqual([]);
    await db.delete(teams).where(eq(teams.id, teamId));
    expect(await db.select().from(uploads).where(eq(uploads.id, badgeId))).toEqual([]);
  });
});

describe('deletion_requests.external_pending (ADR-0032)', () => {
  it('defaults to an empty set and accepts only known external systems', async () => {
    const insert = async (externalPending?: string[]) =>
      db
        .insert(deletionRequests)
        .values({
          userId: await createUser(),
          graceUntil: new Date(Date.now() + 7 * 86_400_000),
          ...(externalPending === undefined
            ? {}
            : { externalPending: externalPending as ['revenuecat'] }),
        })
        .returning({ externalPending: deletionRequests.externalPending });
    expect(await insert()).toEqual([{ externalPending: [] }]);
    expect(await insert(['revenuecat'])).toEqual([{ externalPending: ['revenuecat'] }]);
    await expectPgError(
      insert(['revenuecat', 'stripe']),
      PG_CHECK_VIOLATION,
      'deletion_requests_external_pending_values',
    );
  });
});

describe('users.is_tombstone (ADR-0033)', () => {
  function tombstone(overrides: Partial<typeof users.$inferInsert> = {}) {
    const id = newId();
    return {
      id,
      email: `deleted+${id}@deleted.invalid`,
      displayName: 'Silinmiş oyuncu',
      isTombstone: true,
      deactivatedAt: new Date(),
      ...overrides,
    };
  }

  it('accepts a tombstone without personal data and rejects one with any', async () => {
    await db.insert(users).values(tombstone());
    const violations: Partial<typeof users.$inferInsert>[] = [
      { passwordHash: '$argon2id$v=19$m=65536,t=3,p=1$c2FsdA$aGFzaA' },
      { appleSub: `apple-${uniqueSuffix()}` },
      { googleSub: `google-${uniqueSuffix()}` },
      { avatarKey: 'avatars/x/y' },
      { position: 'GK' },
      { level: 'casual' },
      { districtId },
      { totpSecretEnc: 'ciphertext' },
      { deactivatedAt: null },
    ];
    for (const overrides of violations) {
      await expectPgError(
        db.insert(users).values(tombstone(overrides)),
        PG_CHECK_VIOLATION,
        'users_tombstone_has_no_personal_data',
      );
    }
  });

  it('lets two deleted players keep separate history on the same match', async () => {
    const matchId = await createMatch(await createTeam(await createUser()));
    const [first, second] = await db
      .insert(users)
      .values([tombstone(), tombstone()])
      .returning({ id: users.id });
    if (!first || !second) throw new Error('tombstone insert returned no row');
    await db.insert(matchRsvps).values([
      { matchId, userId: first.id, status: 'in' },
      { matchId, userId: second.id, status: 'in' },
    ]);
    const rows = await db.select().from(matchRsvps).where(eq(matchRsvps.matchId, matchId));
    expect(rows).toHaveLength(2);
  });
});

describe('match_rsvps.waitlisted_at (ADR-0035)', () => {
  it('is set exactly for waitlist rows and orders the waitlist', async () => {
    const matchId = await createMatch(await createTeam(await createUser()));
    const [early, late] = [await createUser(), await createUser()];
    await expectPgError(
      db.insert(matchRsvps).values({ matchId, userId: early, status: 'waitlist' }),
      PG_CHECK_VIOLATION,
      'match_rsvps_waitlisted_at_matches_status',
    );
    await expectPgError(
      db
        .insert(matchRsvps)
        .values({ matchId, userId: early, status: 'in', waitlistedAt: new Date() }),
      PG_CHECK_VIOLATION,
      'match_rsvps_waitlisted_at_matches_status',
    );
    await db.insert(matchRsvps).values([
      { matchId, userId: late, status: 'waitlist', waitlistedAt: new Date(Date.now() - 1_000) },
      { matchId, userId: early, status: 'waitlist', waitlistedAt: new Date(Date.now() - 60_000) },
    ]);
    const queue = await db
      .select({ userId: matchRsvps.userId })
      .from(matchRsvps)
      .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.status, 'waitlist')))
      .orderBy(asc(matchRsvps.waitlistedAt), asc(matchRsvps.id));
    expect(queue.map((row) => row.userId)).toEqual([early, late]);

    await db
      .update(matchRsvps)
      .set({ status: 'in', waitlistedAt: null })
      .where(and(eq(matchRsvps.matchId, matchId), eq(matchRsvps.userId, early)));
  });
});

describe('venues.search_name (ADR-0039)', () => {
  it('finds folded substrings regardless of Turkish case and diacritics', async () => {
    const name = 'Işıklı Gündoğdu Spor Alanı';
    const [venue] = await db
      .insert(venues)
      .values({
        name,
        searchName: foldTr(name),
        slug: `isikli-${uniqueSuffix()}`,
        districtId,
        point: { lng: 27.1, lat: 38.4 },
      })
      .returning({ id: venues.id });
    for (const query of ['IŞIKLI', 'gundogdu', 'Spor ALANI']) {
      const pattern = `%${foldTr(query)}%`;
      const found = await db
        .select({ id: venues.id })
        .from(venues)
        .where(sql`${venues.searchName} like ${pattern}`);
      expect(found).toEqual([{ id: venue?.id }]);
    }
  });
});

describe('roles and grants (ADR-0028)', () => {
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: testDb.url });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  async function privileges(role: string, table: string): Promise<string[]> {
    const { rows } = await admin.query<{ privilege: string }>(
      `select p.privilege from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE']) as p(privilege)
       where has_table_privilege($1, $2, p.privilege) order by 1`,
      [role, table],
    );
    return rows.map((row) => row.privilege);
  }

  it('creates both roles without login', async () => {
    const { rows } = await admin.query<{ rolname: string; rolcanlogin: boolean }>(
      "select rolname, rolcanlogin from pg_roles where rolname in ('kadro_app', 'kadro_worker') order by rolname",
    );
    expect(rows).toEqual([
      { rolname: 'kadro_app', rolcanlogin: false },
      { rolname: 'kadro_worker', rolcanlogin: false },
    ]);
  });

  it('grants every public table explicitly, with the documented exceptions', async () => {
    const { rows } = await admin.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'spatial_ref_sys'",
    );
    const full = ['DELETE', 'INSERT', 'SELECT', 'UPDATE'];
    for (const { table_name: table } of rows) {
      const app = await privileges('kadro_app', table);
      const worker = await privileges('kadro_worker', table);
      if (table === 'job_receipts') {
        expect(app, table).toEqual([]);
        expect(worker, table).toEqual(['DELETE', 'INSERT', 'SELECT']);
      } else if (table === 'push_resends') {
        // UPDATE only on (version, updated_at), a column grant (ADR-0044).
        expect(app, table).toEqual(['INSERT', 'SELECT']);
        expect(worker, table).toEqual(['DELETE', 'SELECT']);
        const { rows: updatable } = await admin.query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'push_resends'
              and has_column_privilege('kadro_app', 'push_resends', column_name, 'UPDATE')
            order by column_name`,
        );
        expect(updatable.map((row) => row.column_name)).toEqual(['updated_at', 'version']);
      } else if (table === 'audit_logs') {
        expect(app, table).toEqual(['INSERT', 'SELECT']);
        expect(worker, table).toEqual(['INSERT', 'SELECT']);
      } else {
        expect(app, table).toEqual(full);
        expect(worker, table).toEqual(full);
      }
    }
  });

  it('lets the worker grant kadro_app send-only access to pg-boss', async () => {
    const { rows: owner } = await admin.query<{ owner: string }>(
      "select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname = 'pgboss'",
    );
    expect(owner).toEqual([{ owner: 'kadro_worker' }]);

    await admin.query('set role kadro_worker');
    try {
      await expectPgError(
        admin.query('select public.kadro_grant_pgboss_send_access()'),
        PG_UNDEFINED_TABLE,
      );
      // Minimal stand-ins for the pg-boss tables the worker creates on start.
      await admin.query('create table pgboss.version (version int primary key)');
      await admin.query('create table pgboss.queue (name text primary key, table_name text)');
      await admin.query('create table pgboss.schedule (name text primary key, data jsonb)');
      await admin.query(
        'create table pgboss.job (id uuid not null, name text not null, data jsonb, start_after timestamptz not null default now()) partition by list (name)',
      );
      await admin.query('create table pgboss.job_common partition of pgboss.job default');
      await admin.query(
        "create table pgboss.j_email partition of pgboss.job for values in ('email.send')",
      );
      await admin.query('select public.kadro_grant_pgboss_send_access()');
    } finally {
      await admin.query('reset role');
    }

    await admin.query('set role kadro_app');
    try {
      const inserted = await admin.query<{ id: string }>(
        "insert into pgboss.j_email (id, name, data) values ($1, 'email.send', '{}') returning id, start_after",
        [newId()],
      );
      expect(inserted.rows).toHaveLength(1);
      await admin.query('select name from pgboss.queue');
      await admin.query('select version from pgboss.version');
      await expectPgError(
        admin.query('select data from pgboss.j_email'),
        PG_INSUFFICIENT_PRIVILEGE,
      );
      await expectPgError(
        admin.query("update pgboss.j_email set data = '{}'"),
        PG_INSUFFICIENT_PRIVILEGE,
      );
      await expectPgError(admin.query('select * from pgboss.schedule'), PG_INSUFFICIENT_PRIVILEGE);
      await expectPgError(admin.query('select * from job_receipts'), PG_INSUFFICIENT_PRIVILEGE);
      await expectPgError(
        admin.query('select public.kadro_grant_pgboss_send_access()'),
        PG_INSUFFICIENT_PRIVILEGE,
      );
    } finally {
      await admin.query('reset role');
    }
  });
});

describe('upgrade from the Phase 1 schema', () => {
  it('applies the Phase 2 migrations on top of Phase 1 data', async () => {
    const { url, drop } = await createEmptyDatabase('kadro_upgrade');
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      // Reproduce a Phase 1 database: migrations 0000-0002 applied and recorded the same way the
      // drizzle migrator records them.
      const phase1 = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).slice(0, 3);
      await client.query('create schema drizzle');
      await client.query(
        'create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)',
      );
      for (const migration of phase1) {
        for (const statement of migration.sql) {
          await client.query(statement);
        }
        await client.query(
          'insert into drizzle.__drizzle_migrations (hash, created_at) values ($1, $2)',
          [migration.hash, migration.folderMillis],
        );
      }

      const sampleName = '[ÖRNEK] Kadıköy Örnek Halı Saha A';
      const ids = {
        district: newId(),
        venue: newId(),
        user: newId(),
        team: newId(),
        match: newId(),
        rsvp: newId(),
      };
      await client.query(
        "insert into districts (id, il, ilce, il_slug, slug, centroid) values ($1, 'İstanbul', 'Kadıköy', 'istanbul', 'kadikoy', ST_SetSRID(ST_MakePoint(29.029, 40.99), 4326)::geography)",
        [ids.district],
      );
      await client.query(
        "insert into venues (id, name, slug, district_id, point, is_sample) values ($1, $2, 'ornek-kadikoy-hali-saha-a', $3, ST_SetSRID(ST_MakePoint(29.035, 40.994), 4326)::geography, true)",
        [ids.venue, sampleName, ids.district],
      );
      await client.query(
        "insert into users (id, email, display_name) values ($1, 'phase1@example.test', 'Faz Bir')",
        [ids.user],
      );
      await client.query(
        "insert into teams (id, name, slug, district_id, owner_id) values ($1, 'Faz Bir Kadro', 'faz-bir', $2, $3)",
        [ids.team, ids.district, ids.user],
      );
      await client.query(
        "insert into matches (id, team_id, starts_at, format, slots, status) values ($1, $2, now() + interval '1 day', '7v7', 14, 'open')",
        [ids.match, ids.team],
      );
      await client.query(
        "insert into match_rsvps (id, match_id, user_id, status) values ($1, $2, $3, 'waitlist')",
        [ids.rsvp, ids.match, ids.user],
      );

      await runMigrations(url);

      const venue = await client.query<{ search_name: string }>(
        'select search_name from venues where id = $1',
        [ids.venue],
      );
      expect(venue.rows).toEqual([{ search_name: foldTr(sampleName) }]);
      const rsvp = await client.query<{ waitlisted_at: Date | null }>(
        'select waitlisted_at from match_rsvps where id = $1',
        [ids.rsvp],
      );
      expect(rsvp.rows[0]?.waitlisted_at).toBeInstanceOf(Date);
      const user = await client.query<{ is_tombstone: boolean }>(
        'select is_tombstone from users where id = $1',
        [ids.user],
      );
      expect(user.rows).toEqual([{ is_tombstone: false }]);
      const applied = await client.query<{ count: string }>(
        'select count(*)::text as count from drizzle.__drizzle_migrations',
      );
      expect(Number(applied.rows[0]?.count)).toBe(
        readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER }).length,
      );
    } finally {
      await client.end();
      await drop();
    }
  });

  it('seeds an upgraded database with folded search names', async () => {
    const result = await seedDatabase(db);
    expect(result.sampleVenues).toBeGreaterThan(0);
    const rows = await db
      .select({ name: venues.name, searchName: venues.searchName })
      .from(venues)
      .where(eq(venues.isSample, true));
    for (const row of rows) {
      expect(row.searchName).toBe(foldTr(row.name));
    }
  });
});
