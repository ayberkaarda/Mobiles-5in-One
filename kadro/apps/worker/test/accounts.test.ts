import { randomBytes } from 'node:crypto';

import {
  auditLogs,
  deletionRequests,
  emailTokens,
  matchRsvps,
  mvpVotes,
  newId,
  openCallApplications,
  recordPushResend,
  refreshTokens,
  teamMembers,
  teams,
  uploads,
  users,
  venueReviews,
  venues,
} from '@kadro/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { TOMBSTONE_DISPLAY_NAME } from '../src/accounts/hard-delete.js';
import { DAY_MS, HOUR_MS } from '../src/clock.js';
import { sha256Hex } from '../src/email/tokens.js';
import { enqueue } from '../src/enqueue.js';
import { hardDeleteIdempotencyKey } from '../src/maintenance/sweep.js';
import {
  type FakeProvider,
  Fixtures,
  RESEND_PATH,
  TEST_INCOMING_BUCKET,
  TEST_MEDIA_BUCKET,
  type TestDatabase,
  type TestWorker,
  createTestDatabase,
  jobsIn,
  startFakeProvider,
  startTestWorker,
  waitFor,
  waitForJobState,
} from './support.js';

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let fixtures: Fixtures;

beforeAll(async () => {
  database = await createTestDatabase('worker_accounts');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, {
    queueOverrides: {
      'account.hard_delete': { retryLimit: 2, retryDelaySeconds: 1, retryBackoff: false },
    },
  });
  fixtures = new Fixtures(database.admin.db);
});

afterAll(async () => {
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

beforeEach(() => {
  provider.s3.fault = undefined;
  provider.s3.before = undefined;
  provider.s3.readOverride = undefined;
  provider.requests.length = 0;
  provider.responders.set(RESEND_PATH, () => ({ status: 200, body: { id: newId() } }));
});

const db = () => database.admin.db;

function uniqueName(): string {
  return `Silinecek ${randomBytes(4).toString('hex')}`;
}

async function deletionRequest(userId: string, graceUntil: Date): Promise<string> {
  const [row] = await db()
    .insert(deletionRequests)
    .values({ userId, requestedAt: new Date(graceUntil.getTime() - 7 * DAY_MS), graceUntil })
    .returning({ id: deletionRequests.id });
  if (!row) throw new Error('deletion request insert failed');
  return row.id;
}

async function runDeletion(requestId: string) {
  const jobId = await enqueue(worker.runtime.boss, 'account.hard_delete', {
    deletionRequestId: requestId,
    idempotencyKey: `${hardDeleteIdempotencyKey(requestId)}:${newId()}`,
  });
  return waitForJobState(database, 'account.hard_delete', jobId ?? '', ['completed'], 30_000);
}

/** Every row of every public table as JSON text, for the "no personal data left" proof. */
async function dumpAllTables(): Promise<{ table: string; row: string }[]> {
  const tables = await database.admin.pool.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = 'public' order by tablename",
  );
  const rows: { table: string; row: string }[] = [];
  for (const { name } of tables.rows) {
    const client = await database.admin.pool.connect();
    try {
      const result = await client.query<{ row: string }>(
        `select row_to_json(t)::text as row from ${client.escapeIdentifier(name)} t`,
      );
      rows.push(...result.rows.map((row) => ({ table: name, row: row.row })));
    } finally {
      client.release();
    }
  }
  return rows;
}

interface Scene {
  readonly victim: { id: string; email: string; displayName: string };
  readonly requestId: string;
  readonly soloTeamId: string;
  readonly sharedTeamId: string;
  readonly lockedTeamId: string;
  readonly memberTeamId: string;
  readonly coCaptainId: string;
  readonly oldestPlayerId: string;
  readonly waitlistedId: string;
  readonly playedMatchId: string;
  readonly openMatchId: string;
  readonly friendId: string;
  readonly venueId: string;
  readonly keepBadge: string;
}

async function scene(): Promise<Scene> {
  const displayName = uniqueName();
  const victim = await fixtures.user({
    displayName,
    deactivatedAt: new Date(Date.now() - 8 * DAY_MS),
  });
  const requestId = await deletionRequest(victim.id, new Date(Date.now() - HOUR_MS));

  // Credentials and devices (removed by cascade).
  await db()
    .insert(refreshTokens)
    .values({
      userId: victim.id,
      tokenHash: sha256Hex(randomBytes(16).toString('hex')),
      client: 'mobile',
      familyId: newId(),
      expiresAt: new Date(Date.now() + DAY_MS),
    });
  await db()
    .insert(emailTokens)
    .values({
      userId: victim.id,
      purpose: 'reset',
      tokenHash: sha256Hex(randomBytes(16).toString('hex')),
      expiresAt: new Date(Date.now() + HOUR_MS),
    });
  await fixtures.pushToken(victim.id);

  // Avatar: published and still incoming objects.
  const avatarId = newId();
  await db()
    .insert(uploads)
    .values({
      id: avatarId,
      userId: victim.id,
      kind: 'avatar',
      contentType: 'image/png',
      contentLength: 10,
      status: 'ready',
      key: `avatars/${victim.id}/${avatarId}`,
    });
  await db()
    .update(users)
    .set({ avatarKey: `avatars/${victim.id}/${avatarId}.webp` })
    .where(eq(users.id, victim.id));
  provider.s3.putObject(
    TEST_MEDIA_BUCKET,
    `avatars/${victim.id}/${avatarId}.webp`,
    Buffer.from('a'),
  );
  provider.s3.putObject(
    TEST_INCOMING_BUCKET,
    `incoming/avatar/${victim.id}/${newId()}`,
    Buffer.from('b'),
  );

  // Solo team: deleted with its matches; its badge objects go first.
  const soloTeamId = await fixtures.team(victim.id, 'Yalnız Kadro');
  provider.s3.putObject(
    TEST_MEDIA_BUCKET,
    `badges/${soloTeamId}/${newId()}.webp`,
    Buffer.from('c'),
  );
  provider.s3.putObject(
    TEST_INCOMING_BUCKET,
    `incoming/badge/${soloTeamId}/${newId()}`,
    Buffer.from('d'),
  );
  const guest = await fixtures.user();
  const soloMatch = await fixtures.match(soloTeamId, { startsAt: new Date(Date.now() + DAY_MS) });
  await fixtures.rsvp(soloMatch, guest.id, 'in');

  // Shared team: the co-captain inherits, although a player joined earlier.
  const oldestPlayer = await fixtures.user();
  const coCaptain = await fixtures.user();
  const sharedTeamId = await fixtures.team(victim.id, 'Ortak Kadro');
  await db()
    .insert(teamMembers)
    .values([
      {
        teamId: sharedTeamId,
        userId: oldestPlayer.id,
        role: 'player',
        joinedAt: new Date(Date.now() - 30 * DAY_MS),
      },
      {
        teamId: sharedTeamId,
        userId: coCaptain.id,
        role: 'co_captain',
        joinedAt: new Date(Date.now() - DAY_MS),
      },
    ]);
  const keepBadge = `badges/${sharedTeamId}/${newId()}.webp`;
  provider.s3.putObject(TEST_MEDIA_BUCKET, keepBadge, Buffer.from('e'));
  await db().update(teams).set({ badgeKey: keepBadge }).where(eq(teams.id, sharedTeamId));

  // Second shared team without co-captain: the oldest member, who already owns a team, inherits
  // it and the team is locked to the Pro tier.
  const lockedTeamId = await fixtures.team(victim.id, 'Kilitli Kadro');
  await db()
    .insert(teamMembers)
    .values({
      teamId: lockedTeamId,
      userId: oldestPlayer.id,
      role: 'player',
      joinedAt: new Date(Date.now() - 20 * DAY_MS),
    });
  await fixtures.team(oldestPlayer.id, 'Kendi Kadrosu');

  // A team where the victim is only a player.
  const owner = await fixtures.user();
  const memberTeamId = await fixtures.team(owner.id, 'Misafir Kadro');
  await fixtures.member(memberTeamId, victim.id);

  // History: a played match with RSVP and MVP votes in both directions.
  const friend = await fixtures.user();
  const playedMatchId = await fixtures.match(sharedTeamId, {
    startsAt: new Date(Date.now() - 10 * DAY_MS),
    status: 'played',
  });
  await fixtures.rsvp(playedMatchId, victim.id, 'in');
  await fixtures.rsvp(playedMatchId, friend.id, 'in');
  await db()
    .insert(mvpVotes)
    .values([
      { matchId: playedMatchId, voterId: victim.id, voteeId: friend.id },
      { matchId: playedMatchId, voterId: friend.id, voteeId: victim.id },
    ]);

  // An open match the victim still holds a slot in, with a waitlist.
  const openMatchId = await fixtures.match(memberTeamId, {
    startsAt: new Date(Date.now() + 2 * DAY_MS),
    slots: 2,
  });
  await fixtures.rsvp(openMatchId, victim.id, 'in');
  await fixtures.rsvp(openMatchId, owner.id, 'in');
  const waitlisted = await fixtures.user();
  await fixtures.rsvp(openMatchId, waitlisted.id, 'waitlist');

  // Content.
  const [venue] = await db()
    .insert(venues)
    .values({
      name: 'Deneme Sahası',
      slug: `deneme-${randomBytes(4).toString('hex')}`,
      searchName: 'deneme sahasi',
      districtId: await fixtures.district(),
      point: { lng: 29, lat: 41 },
      createdBy: victim.id,
    })
    .returning({ id: venues.id });
  if (!venue) throw new Error('venue insert failed');
  await db()
    .insert(venueReviews)
    .values({ venueId: venue.id, userId: victim.id, rating: 4, text: `${displayName} yazdı` });
  const callMatch = await fixtures.match(memberTeamId, {
    startsAt: new Date(Date.now() + 3 * DAY_MS),
  });
  const callId = await fixtures.openCall(callMatch, new Date(Date.now() + DAY_MS));
  await fixtures.application(callId, victim.id);
  // A coalesced push to the victim (a captain) whose follow-up is still pending (ADR-0044).
  await recordPushResend(db(), {
    singletonKey: `rsvp:${openMatchId}:${victim.id}`,
    type: 'rsvp.changed',
    userId: victim.id,
    refId: openMatchId,
    requestedAt: new Date(),
  });
  await db()
    .insert(auditLogs)
    .values({ actorId: victim.id, action: 'auth.login', targetType: 'user', metadata: {} });

  return {
    victim,
    requestId,
    soloTeamId,
    sharedTeamId,
    lockedTeamId,
    memberTeamId,
    coCaptainId: coCaptain.id,
    oldestPlayerId: oldestPlayer.id,
    waitlistedId: waitlisted.id,
    playedMatchId,
    openMatchId,
    friendId: friend.id,
    venueId: venue.id,
    keepBadge,
  };
}

describe('account.hard_delete (ADR-0032, ADR-0033)', () => {
  it('removes every trace of the account and keeps team history on a tombstone', async () => {
    const s = await scene();
    const job = await runDeletion(s.requestId);
    expect(job.output).toEqual({ outcome: 'deleted' });

    // Objects: avatar, incoming and solo-team badge prefixes are empty; the shared badge stays.
    expect(provider.s3.keys(TEST_MEDIA_BUCKET, `avatars/${s.victim.id}/`)).toEqual([]);
    expect(provider.s3.keys(TEST_INCOMING_BUCKET, `incoming/avatar/${s.victim.id}/`)).toEqual([]);
    expect(provider.s3.keys(TEST_MEDIA_BUCKET, `badges/${s.soloTeamId}/`)).toEqual([]);
    expect(provider.s3.keys(TEST_INCOMING_BUCKET, `incoming/badge/${s.soloTeamId}/`)).toEqual([]);
    expect(provider.s3.object(TEST_MEDIA_BUCKET, s.keepBadge)).toBeDefined();

    // No row anywhere carries the email or the name; the old id survives only in audit rows.
    const dump = await dumpAllTables();
    expect(dump.filter((entry) => entry.row.includes(s.victim.email))).toEqual([]);
    expect(dump.filter((entry) => entry.row.includes(s.victim.displayName))).toEqual([]);
    expect(
      dump.filter((entry) => entry.row.includes(s.victim.id) && entry.table !== 'audit_logs'),
    ).toEqual([]);

    // Teams: solo deleted, captaincy transferred (co-captain first, else oldest member).
    const teamRows = await db().select().from(teams);
    const byId = Object.fromEntries(teamRows.map((team) => [team.id, team]));
    expect(byId[s.soloTeamId]).toBeUndefined();
    expect(byId[s.sharedTeamId]).toMatchObject({ ownerId: s.coCaptainId, isProLocked: false });
    expect(byId[s.lockedTeamId]).toMatchObject({ ownerId: s.oldestPlayerId, isProLocked: true });
    const [sharedCaptain] = await db()
      .select({ userId: teamMembers.userId })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, s.sharedTeamId), eq(teamMembers.role, 'captain')));
    expect(sharedCaptain?.userId).toBe(s.coCaptainId);

    // History on one tombstone without personal data.
    const tombstones = await db().select().from(users).where(eq(users.isTombstone, true));
    expect(tombstones).toHaveLength(1);
    const [tombstone] = tombstones;
    expect(tombstone).toMatchObject({
      displayName: TOMBSTONE_DISPLAY_NAME,
      passwordHash: null,
      avatarKey: null,
      position: null,
      level: null,
      districtId: null,
      appleSub: null,
      googleSub: null,
    });
    expect(tombstone?.email).toMatch(/^deleted\+[0-9a-f-]{36}@deleted\.invalid$/);
    expect(tombstone?.deactivatedAt).not.toBeNull();
    const played = await db()
      .select()
      .from(matchRsvps)
      .where(eq(matchRsvps.matchId, s.playedMatchId));
    expect(played.map((row) => row.userId).sort()).toEqual([s.friendId, tombstone?.id].sort());
    const votes = await db().select().from(mvpVotes).where(eq(mvpVotes.matchId, s.playedMatchId));
    expect(votes.map((vote) => [vote.voterId, vote.voteeId]).sort()).toEqual(
      [
        [tombstone?.id, s.friendId],
        [s.friendId, tombstone?.id],
      ].sort(),
    );

    // The open match freed a slot: the waitlisted player moved in and is notified.
    const open = await db().select().from(matchRsvps).where(eq(matchRsvps.matchId, s.openMatchId));
    expect(open.find((row) => row.userId === s.waitlistedId)?.status).toBe('in');
    const promoted = (await jobsIn(database, 'push.send')).filter(
      (row) => row.data.type === 'rsvp.promoted' && row.data.userId === s.waitlistedId,
    );
    expect(promoted).toHaveLength(1);

    // Content: reviews and applications gone, venue kept without creator.
    expect(
      await db().select().from(venueReviews).where(eq(venueReviews.venueId, s.venueId)),
    ).toEqual([]);
    expect(await db().select().from(openCallApplications)).toEqual([]);
    const [venue] = await db().select().from(venues).where(eq(venues.id, s.venueId));
    expect(venue?.createdBy).toBeNull();

    // Request completed; audit without personal data.
    const [request] = await db()
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, s.requestId));
    expect(request?.completedAt).not.toBeNull();
    expect(request?.userId).toBeNull();
    expect(request?.externalPending).toEqual([]);
    const [audit] = await db()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'account.deleted'), eq(auditLogs.targetId, s.requestId)));
    expect(audit?.actorId).toBeNull();
    expect(audit?.metadata).toEqual({ teamsDeleted: 1, teamsTransferred: 2, objectsDeleted: 4 });
    const transfers = await db()
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.action, 'team.captaincyTransfer'));
    expect(transfers).toHaveLength(2);
    expect(JSON.stringify(transfers)).not.toContain(s.victim.id);

    // Confirmation email to the address that no longer exists in the database.
    const emails = provider.requests.filter((request) => request.path === RESEND_PATH);
    expect(emails).toHaveLength(1);
    expect(emails[0]?.body).toMatchObject({
      to: [s.victim.email],
      subject: 'Kadro: hesabın silindi',
    });
    expect(worker.logs.lines.join('\n')).not.toContain(s.victim.email);
  });

  it('deletes objects before touching the database: a storage failure leaves the account intact', async () => {
    const s = await scene();
    let blocked = true;
    provider.s3.fault = (operation) =>
      blocked &&
      operation.method === 'DELETE' &&
      operation.key.startsWith(`badges/${s.soloTeamId}/`)
        ? 500
        : undefined;
    const jobId = await enqueue(worker.runtime.boss, 'account.hard_delete', {
      deletionRequestId: s.requestId,
      idempotencyKey: hardDeleteIdempotencyKey(s.requestId),
    });
    // The first attempt fails in the storage step; the database is untouched at that point.
    await waitForJobState(database, 'account.hard_delete', jobId ?? '', ['retry']);
    const [user] = await db().select().from(users).where(eq(users.id, s.victim.id));
    expect(user?.email).toBe(s.victim.email);
    expect(await db().select().from(teams).where(eq(teams.id, s.soloTeamId))).toHaveLength(1);
    const [request] = await db()
      .select()
      .from(deletionRequests)
      .where(eq(deletionRequests.id, s.requestId));
    expect(request?.completedAt).toBeNull();
    blocked = false;

    const done = await waitForJobState(
      database,
      'account.hard_delete',
      jobId ?? '',
      ['completed'],
      30_000,
    );
    expect(done.retryCount).toBeGreaterThanOrEqual(1);
    expect(done.output).toEqual({ outcome: 'deleted' });
    expect(await db().select().from(users).where(eq(users.id, s.victim.id))).toEqual([]);
  });

  it('never runs before the grace period ends, after a cancellation, or twice', async () => {
    const early = await fixtures.user({ deactivatedAt: new Date() });
    const earlyRequest = await deletionRequest(early.id, new Date(Date.now() + DAY_MS));
    provider.s3.putObject(
      TEST_MEDIA_BUCKET,
      `avatars/${early.id}/${newId()}.webp`,
      Buffer.from('x'),
    );
    expect((await runDeletion(earlyRequest)).output).toEqual({ outcome: 'skipped_grace_period' });
    expect(provider.s3.keys(TEST_MEDIA_BUCKET, `avatars/${early.id}/`)).toHaveLength(1);

    // Login during the grace period clears deactivated_at (request row still present).
    const returned = await fixtures.user();
    const returnedRequest = await deletionRequest(returned.id, new Date(Date.now() - HOUR_MS));
    expect((await runDeletion(returnedRequest)).output).toEqual({ outcome: 'skipped_cancelled' });

    // Cancellation as implemented: the pending request is deleted.
    const cancelled = await fixtures.user({ deactivatedAt: new Date() });
    const cancelledRequest = await deletionRequest(cancelled.id, new Date(Date.now() - HOUR_MS));
    await db().delete(deletionRequests).where(eq(deletionRequests.id, cancelledRequest));
    expect((await runDeletion(cancelledRequest)).output).toEqual({ outcome: 'skipped_missing' });

    for (const id of [early.id, returned.id, cancelled.id]) {
      expect(await db().select().from(users).where(eq(users.id, id))).toHaveLength(1);
    }

    // Completed requests are not processed again.
    const twice = await fixtures.user({ deactivatedAt: new Date(Date.now() - 8 * DAY_MS) });
    const twiceRequest = await deletionRequest(twice.id, new Date(Date.now() - HOUR_MS));
    expect((await runDeletion(twiceRequest)).output).toEqual({ outcome: 'deleted' });
    expect((await runDeletion(twiceRequest)).output).toEqual({ outcome: 'skipped_completed' });
    expect(provider.requests.filter((r) => r.path === RESEND_PATH)).toHaveLength(1);
  });

  it('decides solo teams under the team lock: a member joining during cleanup cannot inherit a deleted badge', async () => {
    const leaving = await fixtures.user({ deactivatedAt: new Date(Date.now() - 8 * DAY_MS) });
    const requestId = await deletionRequest(leaving.id, new Date(Date.now() - HOUR_MS));
    const teamId = await fixtures.team(leaving.id, 'Son Dakika');
    const badge = `badges/${teamId}/${newId()}.webp`;
    provider.s3.putObject(TEST_MEDIA_BUCKET, badge, Buffer.from('badge'));
    await db().update(teams).set({ badgeKey: badge }).where(eq(teams.id, teamId));
    const joiner = await fixtures.user();

    // While the badge object is being deleted, another user accepts an invite to the team.
    let join: Promise<unknown> | undefined;
    provider.s3.before = async (operation) => {
      if (operation.method === 'DELETE' && operation.key === badge && join === undefined) {
        join = database.admin.pool.query(
          "insert into team_members (id, team_id, user_id, role) values ($1, $2, $3, 'player')",
          [newId(), teamId, joiner.id],
        );
        await Promise.race([
          join.catch(() => undefined),
          new Promise((resolve) => setTimeout(resolve, 1_000)),
        ]);
      }
    };

    expect((await runDeletion(requestId)).output).toEqual({ outcome: 'deleted' });
    const joined = await (join ?? Promise.resolve()).then(
      () => 'joined',
      (error: unknown) => (error as { code?: string }).code,
    );
    const [team] = await db().select().from(teams).where(eq(teams.id, teamId));
    if (team !== undefined) {
      // Had the team survived, its badge would have to exist.
      expect(
        team.badgeKey === null ||
          provider.s3.object(TEST_MEDIA_BUCKET, team.badgeKey) !== undefined,
      ).toBe(true);
    }
    expect(team).toBeUndefined();
    expect(joined).toBe('23503');
  });

  it('decides about RSVPs under the match lock: a match that becomes played keeps its history', async () => {
    const leaving = await fixtures.user({ deactivatedAt: new Date(Date.now() - 8 * DAY_MS) });
    const requestId = await deletionRequest(leaving.id, new Date(Date.now() - HOUR_MS));
    const owner = await fixtures.user();
    const teamId = await fixtures.team(owner.id, 'Kilitli Maç');
    await fixtures.member(teamId, leaving.id);
    const matchId = await fixtures.match(teamId, {
      startsAt: new Date(Date.now() - HOUR_MS),
      status: 'locked',
    });
    await fixtures.rsvp(matchId, leaving.id, 'in');
    await fixtures.rsvp(matchId, owner.id, 'in');

    // The captain closes the match as played while the deletion runs (web locks the match row).
    const captain = await database.admin.pool.connect();
    try {
      await captain.query('begin');
      await captain.query('select id from matches where id = $1 for update', [matchId]);
      const jobId = await enqueue(worker.runtime.boss, 'account.hard_delete', {
        deletionRequestId: requestId,
        idempotencyKey: hardDeleteIdempotencyKey(requestId),
      });
      await waitFor(async () => {
        const waiting = await database.admin.pool.query<{ n: number }>(
          "select count(*)::int as n from pg_stat_activity where datname = $1 and application_name = 'kadro-worker' and wait_event_type = 'Lock'",
          [database.name],
        );
        return (waiting.rows[0]?.n ?? 0) > 0;
      });
      await captain.query("update matches set status = 'played' where id = $1", [matchId]);
      await captain.query('commit');
      const job = await waitForJobState(database, 'account.hard_delete', jobId ?? '', [
        'completed',
      ]);
      expect(job.output).toEqual({ outcome: 'deleted' });
    } finally {
      captain.release();
    }

    const rows = await db().select().from(matchRsvps).where(eq(matchRsvps.matchId, matchId));
    expect(rows).toHaveLength(2);
    const [tombstone] = await db()
      .select()
      .from(users)
      .where(
        and(
          eq(users.isTombstone, true),
          eq(users.id, rows.find((row) => row.userId !== owner.id)?.userId ?? ''),
        ),
      );
    expect(tombstone?.displayName).toBe(TOMBSTONE_DISPLAY_NAME);
  });

  it('completes the deletion even when the confirmation email fails', async () => {
    provider.responders.set(RESEND_PATH, () => ({ status: 503 }));
    const user = await fixtures.user({ deactivatedAt: new Date(Date.now() - 8 * DAY_MS) });
    const requestId = await deletionRequest(user.id, new Date(Date.now() - HOUR_MS));
    const job = await runDeletion(requestId);
    expect(job.output).toEqual({ outcome: 'deleted' });
    expect(job.retryCount).toBe(0);
    expect(await db().select().from(users).where(eq(users.id, user.id))).toEqual([]);
    expect(worker.metrics.count('email_delivery_failed', { kind: 'deletion_completed' })).toBe(1);
  });
});
