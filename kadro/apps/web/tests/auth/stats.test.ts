import { meStatsResponseSchema } from '@kadro/contracts';
import {
  districts,
  type MatchStatus,
  matches,
  matchRsvps,
  mvpVotes,
  type RsvpStatus,
  subscriptions,
  teams,
  venues,
} from '@kadro/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { POST as login } from '../../app/api/v1/auth/login/route';
import { GET as getStats } from '../../app/api/v1/me/stats/route';
import { call, expectProblem } from '../support/http';
import {
  type AuthHarness,
  createUser,
  mobile,
  mobileLogin,
  setupAuthHarness,
  uniqueIp,
} from './support';

/**
 * `GET me/stats` (spec §3 items 9 and 10, authorization matrix §7, ADR-0065): the basic tier for
 * everyone, the full tier with the advanced block only while the caller holds Pro, decided from
 * `subscriptions` at request time.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

let auth: AuthHarness;
let districtId = '';

beforeAll(async () => {
  auth = await setupAuthHarness('web_auth_stats', { RATE_LIMIT_AUTH_MAX: '100' });
  const [district] = await auth.database.client.db
    .insert(districts)
    .values({
      il: 'İstanbul',
      ilce: 'Üsküdar',
      ilSlug: 'istanbul',
      slug: 'uskudar',
      centroid: { lng: 29.02, lat: 41.02 },
    })
    .returning({ id: districts.id });
  districtId = district?.id ?? '';
});

afterAll(async () => {
  await auth.database.dispose();
});

const db = () => auth.database.client.db;
const at = (offsetMs: number) => new Date(auth.harness.runtime.now().getTime() + offsetMs);

async function signedIn() {
  const user = await createUser(auth);
  const session = await mobileLogin(login, user.email, user.password);
  const headers = mobile(uniqueIp(), { authorization: `Bearer ${session.tokens.accessToken}` });
  return { user, headers };
}

async function stats(headers: Record<string, string>) {
  const response = await call(getStats, { headers, path: '/api/v1/me/stats' });
  const text = await response.text();
  expect(response.status, text).toBe(200);
  return meStatsResponseSchema.parse(JSON.parse(text));
}

async function makePro(userId: string, expiresAt: Date | null = at(DAY)): Promise<void> {
  await db().insert(subscriptions).values({
    userId,
    rcAppUserId: userId,
    productId: 'kadro_pro_yearly',
    status: 'active',
    expiresAt,
    environment: 'production',
    store: 'app_store',
  });
}

async function team(ownerId: string, name: string): Promise<string> {
  const [row] = await db()
    .insert(teams)
    .values({ name, slug: `${name.toLowerCase()}-${Date.now()}`, districtId, ownerId })
    .returning({ id: teams.id });
  return row?.id ?? '';
}

async function venue(name: string): Promise<string> {
  const [row] = await db()
    .insert(venues)
    .values({
      name,
      slug: `${name.toLowerCase()}-${Date.now()}`,
      searchName: name.toLowerCase(),
      districtId,
      point: { lng: 29.02, lat: 41.02 },
      verified: true,
    })
    .returning({ id: venues.id });
  return row?.id ?? '';
}

interface MatchSpec {
  readonly teamId: string;
  readonly venueId: string | null;
  readonly status: MatchStatus;
  readonly startsIn: number;
  readonly mvpClosesIn: number | null;
  readonly rsvps: readonly (readonly [string, RsvpStatus])[];
  readonly votes?: readonly (readonly [string, string])[];
}

async function match(spec: MatchSpec): Promise<void> {
  const [row] = await db()
    .insert(matches)
    .values({
      teamId: spec.teamId,
      venueId: spec.venueId,
      venueText: spec.venueId === null ? 'Okul sahası' : null,
      startsAt: at(spec.startsIn),
      format: '7v7',
      slots: 14,
      status: spec.status,
      mvpVoteClosesAt: spec.mvpClosesIn === null ? null : at(spec.mvpClosesIn),
    })
    .returning({ id: matches.id });
  const matchId = row?.id ?? '';
  await db()
    .insert(matchRsvps)
    .values(spec.rsvps.map(([userId, status]) => ({ matchId, userId, status })));
  if (spec.votes !== undefined && spec.votes.length > 0) {
    await db()
      .insert(mvpVotes)
      .values(spec.votes.map(([voterId, voteeId]) => ({ matchId, voterId, voteeId })));
  }
}

describe('GET me/stats', () => {
  let me: Awaited<ReturnType<typeof signedIn>>;

  beforeAll(async () => {
    me = await signedIn();
    const a = (await createUser(auth)).id;
    const b = (await createUser(auth)).id;
    const self = me.user.id;
    const t1 = await team(a, 'Birinci');
    const t2 = await team(b, 'Ikinci');
    const v1 = await venue('Bir');
    const v2 = await venue('Iki');
    const all = (status: RsvpStatus = 'in') =>
      [
        [self, status],
        [a, 'in'],
        [b, 'in'],
      ] as const;
    // MVP with a clear majority, 2 days ago.
    await match({
      teamId: t1,
      venueId: v1,
      status: 'played',
      startsIn: -2 * DAY,
      mvpClosesIn: -DAY,
      rsvps: all(),
      votes: [
        [a, self],
        [b, self],
        [self, a],
      ],
    });
    // Someone else's MVP, 10 days ago.
    await match({
      teamId: t1,
      venueId: v1,
      status: 'played',
      startsIn: -10 * DAY,
      mvpClosesIn: -9 * DAY,
      rsvps: all(),
      votes: [
        [a, b],
        [self, b],
      ],
    });
    // Tied MVP 40 days ago: counts for every winner, outside the 30-day window.
    await match({
      teamId: t2,
      venueId: v2,
      status: 'played',
      startsIn: -40 * DAY,
      mvpClosesIn: -39 * DAY,
      rsvps: all(),
      votes: [
        [a, self],
        [self, a],
      ],
    });
    // Played without a directory venue, vote window still open: no MVP yet.
    await match({
      teamId: t2,
      venueId: null,
      status: 'played',
      startsIn: -5 * DAY,
      mvpClosesIn: HOUR,
      rsvps: all(),
      votes: [[a, self]],
    });
    // Played, but the caller was out or undecided: attendance only.
    await match({
      teamId: t1,
      venueId: v2,
      status: 'played',
      startsIn: -3 * DAY,
      mvpClosesIn: -2 * DAY,
      rsvps: all('out'),
    });
    await match({
      teamId: t2,
      venueId: v1,
      status: 'played',
      startsIn: -4 * DAY,
      mvpClosesIn: -3 * DAY,
      rsvps: all('maybe'),
    });
    // Not played: never counted.
    await match({
      teamId: t1,
      venueId: v1,
      status: 'open',
      startsIn: 2 * DAY,
      mvpClosesIn: null,
      rsvps: all(),
    });
    await match({
      teamId: t2,
      venueId: v2,
      status: 'cancelled',
      startsIn: -6 * DAY,
      mvpClosesIn: null,
      rsvps: all(),
    });
  });

  it('answers the basic tier to a free user', async () => {
    expect(await stats(me.headers)).toEqual({ tier: 'basic', matchesPlayed: 4, mvpCount: 2 });
  });

  it('answers the full tier while the caller holds Pro, and basic again once it lapses', async () => {
    await makePro(me.user.id, at(5 * MINUTE));
    expect(await stats(me.headers)).toEqual({
      tier: 'full',
      matchesPlayed: 4,
      mvpCount: 2,
      advanced: {
        matchesPlayedLast30Days: 3,
        mvpRate: 0.5,
        attendanceRate: 4 / 6,
        distinctVenues: 2,
        distinctTeams: 2,
      },
    });
    // The row still says `active`; its expiry alone ends the full tier.
    auth.harness.advance(10 * MINUTE);
    const lapsed = await stats(me.headers);
    expect(lapsed.tier).toBe('basic');
    expect(lapsed).not.toHaveProperty('advanced');
  });

  it('a new Pro user without matches gets zeros and null rates', async () => {
    const fresh = await signedIn();
    expect(await stats(fresh.headers)).toEqual({ tier: 'basic', matchesPlayed: 0, mvpCount: 0 });
    await makePro(fresh.user.id, null);
    expect(await stats(fresh.headers)).toEqual({
      tier: 'full',
      matchesPlayed: 0,
      mvpCount: 0,
      advanced: {
        matchesPlayedLast30Days: 0,
        mvpRate: null,
        attendanceRate: null,
        distinctVenues: 0,
        distinctTeams: 0,
      },
    });
  });

  it('is 401 without credentials', async () => {
    await expectProblem(
      await call(getStats, { headers: mobile(), path: '/api/v1/me/stats' }),
      401,
      'unauthenticated',
    );
  });
});
