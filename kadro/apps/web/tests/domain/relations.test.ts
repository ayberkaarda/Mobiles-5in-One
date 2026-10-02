import { randomUUID } from 'node:crypto';

import { type ActorContext, can, type Decision, type ResourceContext } from '@kadro/auth';
import { type Action } from '@kadro/contracts';
import {
  type Database,
  districts,
  matches,
  matchRsvps,
  type MatchStatus,
  newId,
  subscriptions,
  openCallApplications,
  openCalls,
  teamMembers,
  teams,
  type TeamRole,
  uploads,
  users,
  venueReviews,
  venues,
} from '@kadro/db';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createRelationLoader,
  loadApplicationRelation,
  loadLineupRelation,
  loadMatchRelation,
  loadMemberTargetRelation,
  loadOpenCallRelation,
  loadPaymentTargetRelation,
  loadTeamCreateFacts,
  loadTeamRelation,
  loadUploadOwnership,
  loadVenueRelation,
} from '../../lib/server/domain/relations';
import { createMigratedDatabase, type TestDatabase } from '../support/db';

let database: TestDatabase;
let db: Database;

/** Matrix §9.2 fixtures plus the deactivated, tombstone and stray-RSVP cases. */
const u = {
  capA: '',
  coA: '',
  plyA: '',
  capB: '',
  gstM1: '',
  exPlyA: '',
  appC1: '',
  uNoTeam: '',
  uDeactivated: '',
  tombstone: '',
  stray: '',
  appB: '',
};
type Fixture = keyof typeof u;

let teamA = '';
let teamB = '';
let m1 = '';
let mPlayed = '';
let mLocked = '';
let mB = '';
let c1 = '';
let cB = '';
let appGst = '';
let appPending = '';
let appOtherCall = '';
let venueVerified = '';
let venueUnverified = '';
let venueSample = '';
let reviewCapA = '';
let uploadCapA = '';

const DAY = 86_400_000;
/** Clock of the relation loaders; subscription expiries are placed around it. */
const NOW = new Date();

async function insertUser(name: Fixture, extra: Partial<typeof users.$inferInsert> = {}) {
  const [row] = await db
    .insert(users)
    .values({
      email: `${name.toLowerCase()}-${randomUUID()}@example.test`,
      displayName: name,
      emailVerifiedAt: new Date(),
      ...extra,
    })
    .returning({ id: users.id });
  u[name] = row?.id ?? '';
}

async function insertMatch(teamId: string, status: MatchStatus, venueId: string | null) {
  const [row] = await db
    .insert(matches)
    .values({
      teamId,
      venueId,
      startsAt: new Date(Date.now() + (status === 'played' ? -DAY : DAY)),
      format: '7v7',
      slots: 14,
      status,
      lockedAt: status === 'locked' ? new Date() : null,
    })
    .returning({ id: matches.id });
  return row?.id ?? '';
}

beforeAll(async () => {
  database = await createMigratedDatabase('web_domain_relations');
  db = database.client.db;
  const [district] = await db
    .insert(districts)
    .values({
      il: 'İstanbul',
      ilce: 'Kadıköy',
      ilSlug: 'istanbul',
      slug: 'kadikoy',
      centroid: { lng: 29.03, lat: 40.99 },
    })
    .returning({ id: districts.id });
  const districtId = district?.id ?? '';

  for (const name of Object.keys(u) as Fixture[]) {
    if (name === 'uDeactivated') {
      await insertUser(name, { deactivatedAt: new Date() });
    } else if (name === 'tombstone') {
      await insertUser(name, {
        email: `deleted+${randomUUID()}@deleted.invalid`,
        displayName: 'Silinmiş oyuncu',
        emailVerifiedAt: null,
        deactivatedAt: new Date(),
        isTombstone: true,
      });
    } else {
      await insertUser(name);
    }
  }

  const [a] = await db
    .insert(teams)
    .values({ name: 'Takım A', slug: `takim-a-${Date.now()}`, districtId, ownerId: u.capA })
    .returning({ id: teams.id });
  const [b] = await db
    .insert(teams)
    .values({
      name: 'Takım B',
      slug: `takim-b-${Date.now()}`,
      districtId,
      ownerId: u.capB,
      isProLocked: true,
    })
    .returning({ id: teams.id });
  teamA = a?.id ?? '';
  teamB = b?.id ?? '';
  const memberships: [string, string, TeamRole][] = [
    [teamA, u.capA, 'captain'],
    [teamA, u.coA, 'co_captain'],
    [teamA, u.plyA, 'player'],
    [teamA, u.uDeactivated, 'player'],
    [teamB, u.capB, 'captain'],
  ];
  await db
    .insert(teamMembers)
    .values(memberships.map(([teamId, userId, role]) => ({ teamId, userId, role })));

  const point = { lng: 29.03, lat: 40.99 };
  const venueRows = await db
    .insert(venues)
    .values([
      {
        name: 'Doğrulanmış Saha',
        slug: `dogrulanmis-${Date.now()}`,
        searchName: 'dogrulanmis saha',
        districtId,
        point,
        verified: true,
      },
      {
        name: 'Yeni Saha',
        slug: `yeni-${Date.now()}`,
        searchName: 'yeni saha',
        districtId,
        point,
        createdBy: u.uNoTeam,
      },
      {
        name: '[ÖRNEK] Örnek Saha',
        slug: `ornek-${Date.now()}`,
        searchName: '[ornek] ornek saha',
        districtId,
        point,
        isSample: true,
      },
    ])
    .returning({ id: venues.id });
  venueVerified = venueRows[0]?.id ?? '';
  venueUnverified = venueRows[1]?.id ?? '';
  venueSample = venueRows[2]?.id ?? '';

  m1 = await insertMatch(teamA, 'open', venueVerified);
  mPlayed = await insertMatch(teamA, 'played', venueVerified);
  mLocked = await insertMatch(teamA, 'locked', venueVerified);
  mB = await insertMatch(teamB, 'open', venueSample);

  const callRows = await db
    .insert(openCalls)
    .values([
      {
        matchId: m1,
        missingCount: 2,
        level: 'casual',
        districtId,
        expiresAt: new Date(Date.now() + DAY / 2),
      },
      {
        matchId: mB,
        missingCount: 1,
        level: 'regular',
        districtId,
        expiresAt: new Date(Date.now() + DAY / 2),
      },
    ])
    .returning({ id: openCalls.id });
  c1 = callRows[0]?.id ?? '';
  cB = callRows[1]?.id ?? '';
  const appRows = await db
    .insert(openCallApplications)
    .values([
      { openCallId: c1, userId: u.gstM1, status: 'accepted' },
      { openCallId: c1, userId: u.appC1, status: 'pending' },
      { openCallId: cB, userId: u.appB, status: 'pending' },
    ])
    .returning({ id: openCallApplications.id });
  appGst = appRows[0]?.id ?? '';
  appPending = appRows[1]?.id ?? '';
  appOtherCall = appRows[2]?.id ?? '';

  await db.insert(matchRsvps).values([
    { matchId: m1, userId: u.plyA, status: 'in' },
    { matchId: m1, userId: u.gstM1, status: 'in' },
    // An RSVP on an open match with neither membership nor an accepted application.
    { matchId: m1, userId: u.stray, status: 'in' },
    { matchId: mPlayed, userId: u.capA, status: 'in' },
    { matchId: mPlayed, userId: u.coA, status: 'out' },
    { matchId: mPlayed, userId: u.exPlyA, status: 'in' },
    { matchId: mPlayed, userId: u.tombstone, status: 'in' },
    // A row that removal should have deleted (ADR-0005); it must not make a guest.
    { matchId: mLocked, userId: u.exPlyA, status: 'in' },
  ]);

  const [review] = await db
    .insert(venueReviews)
    .values({ venueId: venueVerified, userId: u.capA, rating: 4 })
    .returning({ id: venueReviews.id });
  reviewCapA = review?.id ?? '';

  uploadCapA = newId();
  await db.insert(uploads).values({
    id: uploadCapA,
    userId: u.capA,
    kind: 'avatar',
    contentType: 'image/webp',
    contentLength: 1024,
    key: `avatars/${u.capA}/${uploadCapA}`,
  });
});

afterAll(async () => {
  await database.dispose();
});

function actor(userId: string): ActorContext {
  return {
    userId,
    platformRole: 'user',
    emailVerified: true,
    deactivated: false,
    stepUpUntil: null,
    isPro: false,
  };
}

function outcome(decision: Decision): string {
  if (decision.allow) {
    return decision.rows ?? decision.projection ?? 'allow';
  }
  return String(decision.status);
}

function decide(userId: string, action: Action, facts: ResourceContext): string {
  return outcome(can(actor(userId), action, facts));
}

describe('team relationship', () => {
  it.each([
    ['capA', 'captain'],
    ['coA', 'co_captain'],
    ['plyA', 'player'],
    ['capB', null],
    ['uNoTeam', null],
    ['gstM1', null],
    ['exPlyA', null],
    ['uDeactivated', null],
    ['tombstone', null],
  ] as const)('%s → teamRole %s', async (name, role) => {
    const relation = await loadTeamRelation(db, u[name], teamA);
    expect(relation).toEqual({
      teamId: teamA,
      ownerId: u.capA,
      facts: { teamRole: role, teamProLocked: false },
    });
  });

  it('anonymous callers have no role; a missing or malformed id is null', async () => {
    expect((await loadTeamRelation(db, null, teamA))?.facts.teamRole).toBeNull();
    expect(await loadTeamRelation(db, u.capA, randomUUID())).toBeNull();
    expect(await loadTeamRelation(db, u.capA, 'not-a-uuid')).toBeNull();
  });

  it('reports is_pro_locked of the addressed team', async () => {
    const relation = await loadTeamRelation(db, u.capB, teamB);
    expect(relation?.facts).toEqual({ teamRole: 'captain', teamProLocked: true });
    expect(decide(u.capB, 'match.create', relation?.facts ?? {})).toBe('403');
  });

  it.each([
    ['capA', 'allow', 'allow', 'allow', '409'],
    ['coA', 'allow', 'allow', '403', '409'],
    ['plyA', 'allow', '403', '403', '409'],
    ['capB', '404', '404', '404', 'allow'],
    ['gstM1', '404', '404', '404', 'allow'],
    ['exPlyA', '404', '404', '404', 'allow'],
  ] as const)(
    '%s: team.read %s, team.update %s, team.delete %s, invite.accept %s',
    async (name, read, update, remove, accept) => {
      const facts = (await loadTeamRelation(db, u[name], teamA))?.facts ?? {};
      expect(decide(u[name], 'team.read', facts)).toBe(read);
      expect(decide(u[name], 'team.update', facts)).toBe(update);
      expect(decide(u[name], 'team.delete', facts)).toBe(remove);
      expect(decide(u[name], 'invite.accept', facts)).toBe(accept);
    },
  );
});

describe('member target relationship', () => {
  it('loads actor and target membership of the same team', async () => {
    const relation = await loadMemberTargetRelation(db, u.coA, teamA, u.plyA, NOW);
    expect(relation?.facts.teamRole).toBe('co_captain');
    expect(relation?.target).toEqual({
      userId: u.plyA,
      teamRole: 'player',
      facts: { isSelf: false, targetTeamRole: 'player', targetOwnedTeams: 0, targetIsPro: false },
    });
    const facts = { ...relation?.facts, ...relation?.target?.facts };
    expect(decide(u.coA, 'member.remove', facts)).toBe('allow');
  });

  it('marks self and counts owned teams for a captaincy transfer', async () => {
    const self = await loadMemberTargetRelation(db, u.capA, teamA, u.capA, NOW);
    expect(self?.target?.facts).toEqual({
      isSelf: true,
      targetTeamRole: 'captain',
      targetOwnedTeams: 1,
      targetIsPro: false,
    });
    expect(decide(u.capA, 'member.remove', { ...self?.facts, ...self?.target?.facts })).toBe('409');
  });

  it('a target outside the team is null, never a member of another team', async () => {
    const relation = await loadMemberTargetRelation(db, u.capA, teamA, u.capB, NOW);
    expect(relation?.facts.teamRole).toBe('captain');
    expect(relation?.target).toBeNull();
    expect((await loadMemberTargetRelation(db, u.capA, teamA, 'x', NOW))?.target).toBeNull();
    expect(await loadMemberTargetRelation(db, u.capA, randomUUID(), u.plyA, NOW)).toBeNull();
  });

  it('a deactivated actor is not a member even of its own team', async () => {
    const relation = await loadMemberTargetRelation(db, u.uDeactivated, teamA, u.uDeactivated, NOW);
    expect(relation?.facts.teamRole).toBeNull();
    expect(relation?.target?.facts.isSelf).toBe(false);
  });

  it("reports the target's Pro entitlement at the loader's clock (matrix §7)", async () => {
    const [row] = await db
      .insert(subscriptions)
      .values({
        userId: u.coA,
        rcAppUserId: u.coA,
        productId: 'kadro_pro_monthly',
        status: 'active',
        expiresAt: new Date(NOW.getTime() + DAY),
        environment: 'production',
        store: 'app_store',
      })
      .returning({ id: subscriptions.id });
    const subscriptionId = row?.id ?? '';
    const targetIsPro = async (now: Date) =>
      (await loadMemberTargetRelation(db, u.capA, teamA, u.coA, now))?.target?.facts.targetIsPro;
    try {
      expect(await targetIsPro(NOW)).toBe(true);
      // An `active` row whose expiry has passed no longer grants Pro.
      expect(await targetIsPro(new Date(NOW.getTime() + 2 * DAY))).toBe(false);
      await db
        .update(subscriptions)
        .set({ status: 'billing_issue' })
        .where(eq(subscriptions.id, subscriptionId));
      expect(await targetIsPro(NOW)).toBe(false);
      await db
        .update(subscriptions)
        .set({ status: 'grace_period', expiresAt: null })
        .where(eq(subscriptions.id, subscriptionId));
      expect(await targetIsPro(NOW)).toBe(true);
      // Another user's subscription never leaks into the target's facts.
      expect(
        (await loadMemberTargetRelation(db, u.capA, teamA, u.plyA, NOW))?.target?.facts.targetIsPro,
      ).toBe(false);
    } finally {
      await db.delete(subscriptions).where(eq(subscriptions.id, subscriptionId));
    }
  });

  it('counts owned teams for team.create', async () => {
    expect(await loadTeamCreateFacts(db, u.capA)).toEqual({ actorOwnedTeams: 1 });
    expect(await loadTeamCreateFacts(db, u.uNoTeam)).toEqual({ actorOwnedTeams: 0 });
    expect(await loadTeamCreateFacts(db, null)).toEqual({ actorOwnedTeams: 0 });
  });
});

describe('match relationship', () => {
  it.each([
    ['capA', 'm1', 'captain', false, null],
    ['coA', 'm1', 'co_captain', false, null],
    ['plyA', 'm1', 'player', false, 'in'],
    ['gstM1', 'm1', null, true, 'in'],
    ['stray', 'm1', null, false, 'in'],
    ['appC1', 'm1', null, false, null],
    ['capB', 'm1', null, false, null],
    ['exPlyA', 'mPlayed', null, true, 'in'],
    ['exPlyA', 'mLocked', null, false, 'in'],
    ['tombstone', 'mPlayed', null, false, null],
    ['uDeactivated', 'm1', null, false, null],
  ] as const)(
    '%s on %s → teamRole %s, guest %s, rsvp %s',
    async (name, match, role, guest, rsvp) => {
      const matchId = { m1, mPlayed, mLocked }[match];
      const relation = await loadMatchRelation(db, u[name], matchId);
      expect(relation).toMatchObject({
        matchId,
        teamId: teamA,
        rsvpStatus: rsvp,
        facts: { teamRole: role, isMatchGuest: guest, teamProLocked: false },
      });
    },
  );

  it.each([
    ['capA', 'm1', 'member', 'member'],
    ['plyA', 'm1', 'member', '403'],
    ['gstM1', 'm1', 'guest', '403'],
    ['stray', 'm1', '404', '404'],
    ['capB', 'm1', '404', '404'],
    ['exPlyA', 'mPlayed', 'guest', '403'],
    ['exPlyA', 'mLocked', '404', '404'],
  ] as const)('%s on %s: match.read %s, match.update %s', async (name, match, read, update) => {
    const facts = (await loadMatchRelation(db, u[name], { m1, mPlayed, mLocked }[match]))?.facts;
    expect(decide(u[name], 'match.read', facts ?? {})).toBe(read);
    expect(decide(u[name], 'match.update', facts ?? {})).toBe(update);
  });

  it('reports the status and is null for an unknown match', async () => {
    expect((await loadMatchRelation(db, u.capA, mLocked))?.status).toBe('locked');
    expect(await loadMatchRelation(db, u.capA, randomUUID())).toBeNull();
    expect((await loadMatchRelation(db, null, m1))?.facts).toEqual({
      teamRole: null,
      isMatchGuest: false,
      teamProLocked: false,
    });
  });
});

describe('open call relationship', () => {
  it.each([
    ['capA', 'captain', false, false, null],
    ['coA', 'co_captain', false, false, null],
    ['plyA', 'player', false, false, null],
    ['gstM1', null, true, true, 'accepted'],
    ['appC1', null, false, true, 'pending'],
    ['appB', null, false, false, null],
    ['capB', null, false, false, null],
    ['uNoTeam', null, false, false, null],
  ] as const)(
    '%s → teamRole %s, guest %s, applicant %s (%s)',
    async (name, role, guest, applicant, status) => {
      const relation = await loadOpenCallRelation(db, u[name], c1);
      expect(relation).toMatchObject({
        openCallId: c1,
        matchId: m1,
        teamId: teamA,
        callStatus: 'open',
        matchStatus: 'open',
        facts: {
          teamRole: role,
          isMatchGuest: guest,
          isApplicant: applicant,
          teamProLocked: false,
        },
      });
      expect(relation?.application?.status ?? null).toBe(status);
    },
  );

  it.each([
    ['capA', 'all', '409'],
    ['coA', 'all', '409'],
    ['plyA', '404', '409'],
    ['gstM1', 'own', '409'],
    ['appC1', 'own', 'member'],
    ['capB', '404', 'member'],
    ['uNoTeam', '404', 'member'],
  ] as const)('%s: application.list %s, application.create %s', async (name, list, create) => {
    const facts = (await loadOpenCallRelation(db, u[name], c1))?.facts ?? {};
    expect(decide(u[name], 'application.list', facts)).toBe(list);
    expect(decide(u[name], 'application.create', facts)).toBe(create);
  });

  it('is null for an unknown call', async () => {
    expect(await loadOpenCallRelation(db, u.capA, randomUUID())).toBeNull();
  });
});

describe('application relationship', () => {
  it.each([
    ['capA', 'appPending', 'allow', '403'],
    ['coA', 'appPending', 'allow', '403'],
    ['plyA', 'appPending', '404', '404'],
    ['gstM1', 'appPending', '404', '404'],
    ['appC1', 'appPending', '403', 'allow'],
    ['capB', 'appPending', '404', '404'],
    ['gstM1', 'appGst', '403', 'allow'],
  ] as const)('%s on %s: decide %s, withdraw %s', async (name, app, decideCell, withdraw) => {
    const relation = await loadApplicationRelation(db, u[name], c1, { appPending, appGst }[app]);
    expect(relation?.openCallId).toBe(c1);
    const facts = relation?.facts ?? {};
    expect(decide(u[name], 'application.decide', facts)).toBe(decideCell);
    expect(decide(u[name], 'application.withdraw', facts)).toBe(withdraw);
  });

  it('returns the application with its applicant and states', async () => {
    expect(await loadApplicationRelation(db, u.coA, c1, appPending)).toEqual({
      applicationId: appPending,
      openCallId: c1,
      matchId: m1,
      teamId: teamA,
      applicantId: u.appC1,
      status: 'pending',
      callStatus: 'open',
      matchStatus: 'open',
      facts: {
        teamRole: 'co_captain',
        isMatchGuest: false,
        isApplicant: false,
        teamProLocked: false,
      },
    });
  });

  it('an application addressed under another call is null (nested id mismatch → 404)', async () => {
    expect(await loadApplicationRelation(db, u.capA, c1, appOtherCall)).toBeNull();
    expect(await loadApplicationRelation(db, u.capB, c1, appOtherCall)).toBeNull();
    expect(await loadApplicationRelation(db, u.capA, cB, appPending)).toBeNull();
    expect(await loadApplicationRelation(db, u.capA, c1, 'nope')).toBeNull();
  });

  it('a deactivated or tombstone actor is never the applicant', async () => {
    const [tombApp] = await db
      .insert(openCallApplications)
      .values({ openCallId: cB, userId: u.tombstone, status: 'withdrawn' })
      .returning({ id: openCallApplications.id });
    const relation = await loadApplicationRelation(db, u.tombstone, cB, tombApp?.id ?? '');
    expect(relation?.facts.isApplicant).toBe(false);
    expect(relation?.applicantId).toBe(u.tombstone);
  });
});

describe('venue relationship', () => {
  it('playedAtVenue needs an `in` RSVP on a played match at that venue', async () => {
    const facts = async (name: Fixture) =>
      (await loadVenueRelation(db, u[name], { id: venueVerified }))?.facts;
    expect(await facts('capA')).toEqual({
      venuePublic: true,
      isCreator: false,
      playedAtVenue: true,
      ownsResource: true,
    });
    expect((await facts('exPlyA'))?.playedAtVenue).toBe(true);
    // `out` on the played match, `in` only on an open match, `in` only on a locked match.
    expect((await facts('coA'))?.playedAtVenue).toBe(false);
    expect((await facts('plyA'))?.playedAtVenue).toBe(false);
    expect((await facts('tombstone'))?.playedAtVenue).toBe(false);
    expect((await facts('uNoTeam'))?.playedAtVenue).toBe(false);
    expect(decide(u.capA, 'review.create', (await facts('capA')) ?? {})).toBe('allow');
    expect(decide(u.plyA, 'review.create', (await facts('plyA')) ?? {})).toBe('403');
  });

  it('ownsResource is the own review only', async () => {
    const own = await loadVenueRelation(db, u.capA, { id: venueVerified });
    expect(own?.ownReviewId).toBe(reviewCapA);
    expect(decide(u.capA, 'review.deleteOwn', own?.facts ?? {})).toBe('allow');
    const other = await loadVenueRelation(db, u.exPlyA, { id: venueVerified });
    expect(other?.ownReviewId).toBeNull();
    expect(decide(u.exPlyA, 'review.deleteOwn', other?.facts ?? {})).toBe('404');
  });

  it('an unverified venue is readable by its creator only; sample venues by everyone', async () => {
    const creator = await loadVenueRelation(db, u.uNoTeam, { id: venueUnverified });
    expect(creator?.facts).toMatchObject({ venuePublic: false, isCreator: true });
    expect(decide(u.uNoTeam, 'review.deleteOwn', creator?.facts ?? {})).toBe('404');
    const outsider = await loadVenueRelation(db, u.capA, { id: venueUnverified });
    expect(outsider?.facts).toMatchObject({ venuePublic: false, isCreator: false });
    expect(decide(u.capA, 'review.create', outsider?.facts ?? {})).toBe('404');
    const anonymous = await loadVenueRelation(db, null, { slug: creator?.slug ?? '' });
    expect(anonymous?.facts).toEqual({
      venuePublic: false,
      isCreator: false,
      playedAtVenue: false,
      ownsResource: false,
    });
    expect((await loadVenueRelation(db, null, { id: venueSample }))?.facts.venuePublic).toBe(true);
  });

  it('a deactivated creator loses creator visibility; unknown venues are null', async () => {
    await db.update(users).set({ deactivatedAt: new Date() }).where(eqId(u.uNoTeam));
    try {
      const relation = await loadVenueRelation(db, u.uNoTeam, { id: venueUnverified });
      expect(relation?.facts.isCreator).toBe(false);
    } finally {
      await db.update(users).set({ deactivatedAt: null }).where(eqId(u.uNoTeam));
    }
    expect(await loadVenueRelation(db, u.capA, { slug: 'olmayan-saha' })).toBeNull();
    expect(await loadVenueRelation(db, u.capA, { id: 'bad' })).toBeNull();
  });
});

function eqId(id: string) {
  return eq(users.id, id);
}

describe('payment target relationship', () => {
  it.each([
    ['capA', 'capA', true, 'member'],
    ['coA', 'coA', true, '403'],
    ['coA', 'capA', false, 'member'],
    ['plyA', 'capA', false, '403'],
    ['exPlyA', 'capA', false, '403'],
    ['capB', 'capA', false, '404'],
    ['uDeactivated', 'uDeactivated', false, '404'],
  ] as const)(
    '%s marking %s on the played match: isSelf %s → %s',
    async (name, target, self, result) => {
      const relation = await loadPaymentTargetRelation(db, u[name], mPlayed, u[target]);
      expect(relation?.facts.isSelf).toBe(self);
      expect(decide(u[name], 'payment.mark', relation?.facts ?? {})).toBe(result);
    },
  );

  it('loads the target RSVP inside the match with its state', async () => {
    const relation = await loadPaymentTargetRelation(db, u.capA, mPlayed, u.coA);
    expect(relation).toMatchObject({ matchId: mPlayed, teamId: teamA, status: 'played' });
    expect(relation?.target).toEqual({
      userId: u.coA,
      rsvpStatus: 'out',
      confirmed: false,
      paid: false,
      side: null,
      teamRole: 'co_captain',
      isTombstone: false,
    });
    const tomb = await loadPaymentTargetRelation(db, u.capA, mPlayed, u.tombstone);
    expect(tomb?.target).toMatchObject({ confirmed: true, teamRole: null, isTombstone: true });
    const former = await loadPaymentTargetRelation(db, u.capA, mPlayed, u.exPlyA);
    expect(former?.target).toMatchObject({ confirmed: true, teamRole: null, isTombstone: false });
    const captain = await loadPaymentTargetRelation(db, u.coA, mPlayed, u.capA);
    expect(captain?.target).toMatchObject({ confirmed: true, teamRole: 'captain' });
  });

  it('a target without an RSVP on this match is null; unknown matches are null', async () => {
    const outsider = await loadPaymentTargetRelation(db, u.capA, mPlayed, u.uNoTeam);
    expect(outsider?.facts.teamRole).toBe('captain');
    expect(outsider?.target).toBeNull();
    // plyA has an RSVP on m1 only, never on the played match.
    expect((await loadPaymentTargetRelation(db, u.capA, mPlayed, u.plyA))?.target).toBeNull();
    const malformed = await loadPaymentTargetRelation(db, u.capA, mPlayed, 'x');
    expect(malformed?.target).toBeNull();
    expect(malformed?.facts.isSelf).toBe(false);
    expect(await loadPaymentTargetRelation(db, u.capA, randomUUID(), u.coA)).toBeNull();
  });
});

describe('lineup relationship', () => {
  it('loads every confirmed player of the match with role and side', async () => {
    await db.update(matchRsvps).set({ side: 'A' }).where(eq(matchRsvps.userId, u.plyA));
    const relation = await loadLineupRelation(db, u.coA, m1);
    expect(relation).toMatchObject({
      matchId: m1,
      teamId: teamA,
      status: 'open',
      slots: 14,
      maxPerSide: 7,
      facts: { teamRole: 'co_captain', isMatchGuest: false, teamProLocked: false },
    });
    expect(relation?.confirmed).toEqual([
      {
        userId: u.plyA,
        rsvpStatus: 'in',
        confirmed: true,
        paid: false,
        side: 'A',
        teamRole: 'player',
        isTombstone: false,
      },
      {
        userId: u.gstM1,
        rsvpStatus: 'in',
        confirmed: true,
        paid: false,
        side: null,
        teamRole: null,
        isTombstone: false,
      },
      {
        userId: u.stray,
        rsvpStatus: 'in',
        confirmed: true,
        paid: false,
        side: null,
        teamRole: null,
        isTombstone: false,
      },
    ]);
  });

  it('excludes RSVPs that are not `in` and keeps tombstone history rows', async () => {
    const relation = await loadLineupRelation(db, u.capA, mPlayed);
    expect(
      relation?.confirmed.map((player) => [player.userId, player.teamRole, player.isTombstone]),
    ).toEqual(
      expect.arrayContaining([
        [u.capA, 'captain', false],
        [u.exPlyA, null, false],
        [u.tombstone, null, true],
      ]),
    );
    expect(relation?.confirmed.some((player) => player.userId === u.coA)).toBe(false);
    expect((await loadLineupRelation(db, u.capB, mB))?.confirmed).toEqual([]);
    expect(await loadLineupRelation(db, u.capA, randomUUID())).toBeNull();
  });

  it.each([
    ['capA', 'member'],
    ['coA', 'member'],
    ['plyA', '403'],
    ['gstM1', '403'],
    ['stray', '404'],
    ['capB', '404'],
  ] as const)('%s: lineup.set %s', async (name, result) => {
    const relation = await loadLineupRelation(db, u[name], m1);
    expect(decide(u[name], 'lineup.set', relation?.facts ?? {})).toBe(result);
  });
});

describe('upload ownership', () => {
  it('only the uploader owns the upload', async () => {
    const own = await loadUploadOwnership(db, u.capA, uploadCapA);
    expect(own.facts).toEqual({ ownsResource: true });
    expect(own.upload).toMatchObject({ id: uploadCapA, kind: 'avatar', status: 'pending' });
    expect(decide(u.capA, 'upload.read', own.facts)).toBe('allow');
    for (const name of ['capB', 'coA'] as const) {
      const other = await loadUploadOwnership(db, u[name], uploadCapA);
      expect(other).toEqual({ upload: null, facts: { ownsResource: false } });
      expect(decide(u[name], 'upload.complete', other.facts)).toBe('404');
    }
    expect((await loadUploadOwnership(db, null, uploadCapA)).facts.ownsResource).toBe(false);
    expect((await loadUploadOwnership(db, u.capA, randomUUID())).facts.ownsResource).toBe(false);
  });

  it('a deactivated uploader does not own it', async () => {
    await db.update(users).set({ deactivatedAt: new Date() }).where(eqId(u.capA));
    try {
      expect((await loadUploadOwnership(db, u.capA, uploadCapA)).facts.ownsResource).toBe(false);
    } finally {
      await db.update(users).set({ deactivatedAt: null }).where(eqId(u.capA));
    }
  });
});

describe('query count', () => {
  function countingDb(): { db: Database; count: () => number; statements: string[] } {
    const statements: string[] = [];
    const counted = drizzle({
      client: database.client.pool,
      logger: {
        logQuery(query: string) {
          statements.push(query);
        },
      },
    }) as unknown as Database;
    return { db: counted, count: () => statements.length, statements };
  }

  it('each loader is exactly one query', async () => {
    const probe = countingDb();
    await loadTeamRelation(probe.db, u.coA, teamA);
    await loadMemberTargetRelation(probe.db, u.coA, teamA, u.plyA, NOW);
    await loadTeamCreateFacts(probe.db, u.coA);
    await loadMatchRelation(probe.db, u.coA, m1);
    await loadOpenCallRelation(probe.db, u.coA, c1);
    await loadApplicationRelation(probe.db, u.coA, c1, appPending);
    await loadVenueRelation(probe.db, u.coA, { id: venueVerified });
    await loadUploadOwnership(probe.db, u.capA, uploadCapA);
    await loadPaymentTargetRelation(probe.db, u.coA, mPlayed, u.capA);
    await loadLineupRelation(probe.db, u.coA, m1);
    expect(probe.count()).toBe(10);
  });

  it('malformed ids and anonymous ownership checks issue no query', async () => {
    const probe = countingDb();
    await loadTeamRelation(probe.db, u.coA, 'x');
    await loadMatchRelation(probe.db, u.coA, 'x');
    await loadApplicationRelation(probe.db, u.coA, c1, 'x');
    await loadUploadOwnership(probe.db, null, uploadCapA);
    await loadTeamCreateFacts(probe.db, null);
    expect(probe.count()).toBe(0);
  });

  it('the request loader reads each resource once, however often it is asked', async () => {
    const probe = countingDb();
    const loader = createRelationLoader(probe.db, u.coA, NOW);
    const [first, second] = await Promise.all([loader.match(m1), loader.match(m1)]);
    expect(first).toBe(second);
    await loader.match(m1);
    await loader.team(teamA);
    await loader.team(teamA);
    await loader.openCall(c1);
    await loader.application(c1, appPending);
    await loader.application(c1, appPending);
    await loader.venue({ id: venueVerified });
    await loader.venue({ id: venueVerified });
    await loader.upload(uploadCapA);
    await loader.memberTarget(teamA, u.plyA);
    await loader.teamCreate();
    await loader.teamCreate();
    await loader.paymentTarget(mPlayed, u.capA);
    await loader.paymentTarget(mPlayed, u.capA);
    await loader.lineup(m1);
    await loader.lineup(m1);
    expect(probe.count()).toBe(10);
    await loader.match(mPlayed);
    expect(probe.count()).toBe(11);
  });

  it('a failed load is not cached', async () => {
    let calls = 0;
    const failing = {
      select: () => {
        calls += 1;
        throw new Error('boom');
      },
    } as unknown as Database;
    const loader = createRelationLoader(failing, u.coA, NOW);
    await expect(loader.team(teamA)).rejects.toThrow('boom');
    await expect(loader.team(teamA)).rejects.toThrow('boom');
    expect(calls).toBe(2);
  });
});
