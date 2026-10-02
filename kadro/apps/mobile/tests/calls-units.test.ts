import { dehydrate, QueryClient } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';

import { LIMITS } from '../../../packages/contracts/src/limits';
import {
  createApplicationRequestSchema,
  publishOpenCallRequestSchema,
} from '../../../packages/contracts/src/open-calls';
import { LEVELS, POSITIONS } from '../../../packages/contracts/src/users';
import { createCallsApi, NO_FILTERS } from '../src/calls/calls-api';
import {
  type Application,
  type DistrictPublic,
  type MatchMemberView,
  type OpenCallPublic,
} from '../src/calls/contracts';
import {
  APPLICATION_MESSAGE_MAX,
  availableExpiries,
  defaultExpiry,
  districtLabel,
  EXPIRY_SLACK_MS,
  expiryInstant,
  LEVEL_OPTIONS,
  messageIssue,
  missingIssue,
  normalizeMessage,
  POSITION_OPTIONS,
  searchDistricts,
} from '../src/calls/form';
import { callHref, matchCallHref } from '../src/calls/links';
import {
  CALL_MIN_LIFETIME_MS,
  callActive,
  callRelation,
  canDecide,
  canWithdraw,
  freeSlots,
  maxMissingCount,
  MISSING_COUNT_MAX,
  publishBlocker,
} from '../src/calls/permissions';
import {
  applicationsQuery,
  callKeys,
  findListedCall,
  findListedCallForMatch,
  OPEN_CALL_PRIVATE_ROOT,
  openCallQuery,
} from '../src/calls/queries';
import {
  createQueryPersister,
  PERSISTED_QUERY_ROOTS,
  persistOptions,
  shouldPersistQuery,
} from '../src/query/persistence';
import { createTestApi, issueTokens, problem } from './support/api';
import { apiUrl, mswServer } from './support/msw';

const CALL_ID = '0192a0b0-0000-7000-8000-0000000000c1';
const MATCH_ID = '0192a0b0-0000-7000-8000-0000000000a1';
const APP_ID = '0192a0b0-0000-7000-8000-0000000000b1';
const DISTRICT_ID = '0192a0b0-0000-7000-8000-0000000000d1';
const ME_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const OTHER_ID = '0192a0b0-0000-7000-8000-0000000000f2';
const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-10-05T12:00:00.000Z');

function publicCall(overrides: Partial<OpenCallPublic> = {}): OpenCallPublic {
  return {
    id: CALL_ID,
    districtId: DISTRICT_ID,
    startsAt: '2026-10-06T18:00:00.000Z',
    format: '7v7',
    missingCount: 2,
    position: null,
    level: 'regular',
    venue: null,
    teamName: 'Moda Gençlik',
    expiresAt: '2026-10-06T17:00:00.000Z',
    ...overrides,
  };
}

function application(applicantId: string, overrides: Partial<Application> = {}): Application {
  return {
    id: APP_ID,
    openCallId: CALL_ID,
    applicant: {
      id: applicantId,
      displayName: 'Deniz',
      avatarUrl: null,
      position: 'MID',
      level: 'casual',
    },
    message: null,
    status: 'pending',
    createdAt: '2026-10-05T10:00:00.000Z',
    updatedAt: '2026-10-05T10:00:00.000Z',
    ...overrides,
  };
}

function district(id: string, name: string, province: string): DistrictPublic {
  return {
    id,
    province,
    provinceSlug: province.toLowerCase(),
    name,
    slug: name.toLowerCase(),
    centroid: { latitude: 41, longitude: 29 },
  };
}

type MatchFacts = Pick<MatchMemberView, 'status' | 'startsAt' | 'slots' | 'counts'>;

function matchFacts(overrides: Partial<MatchFacts> = {}): MatchFacts {
  return {
    status: 'open',
    startsAt: new Date(NOW + 48 * HOUR).toISOString(),
    slots: 14,
    counts: { in: 10, maybe: 0, out: 0, waitlist: 0 },
    ...overrides,
  };
}

describe('calls api', () => {
  let requests: { method: string; url: string; body: unknown; authorization: string | null }[];

  beforeEach(() => {
    requests = [];
    mswServer.use(
      http.all(apiUrl('/api/v1/*'), async ({ request }) => {
        const text = request.method === 'GET' ? '' : await request.text();
        requests.push({
          method: request.method,
          url: request.url.replace(apiUrl(''), ''),
          body: text === '' ? null : (JSON.parse(text) as unknown),
          authorization: request.headers.get('authorization'),
        });
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
  });

  it('sends the filters, encodes ids and keeps the user out of every body', async () => {
    const { api, session } = createTestApi();
    await session.establish(issueTokens());
    const calls = createCallsApi(api);
    await calls.listOpenCalls(
      { district: DISTRICT_ID, level: 'competitive', position: 'GK' },
      'c1',
    );
    await calls.listOpenCalls(NO_FILTERS, undefined);
    await calls.listDistricts();
    // An id that would leave its path segment is encoded, and the client refuses the path.
    await expect(calls.apply('../teams', undefined)).rejects.toThrow(TypeError);
    await calls.apply(CALL_ID, undefined);
    await calls.apply(CALL_ID, 'Kaleci olarak gelirim');
    await calls.listApplications(CALL_ID, undefined);
    await calls.setApplicationStatus(CALL_ID, APP_ID, 'accepted');
    await calls.closeOpenCall(MATCH_ID);
    await calls.publishOpenCall(MATCH_ID, {
      missingCount: 2,
      position: null,
      level: 'regular',
      expiresAt: '2026-10-06T17:00:00.000Z',
    });
    expect(requests.map(({ method, url, body }) => ({ method, url, body }))).toEqual([
      {
        method: 'GET',
        url: `/api/v1/open-calls?cursor=c1&limit=20&district=${DISTRICT_ID}&level=competitive&position=GK`,
        body: null,
      },
      { method: 'GET', url: '/api/v1/open-calls?limit=20', body: null },
      { method: 'GET', url: '/api/v1/districts', body: null },
      { method: 'POST', url: `/api/v1/open-calls/${CALL_ID}/applications`, body: {} },
      {
        method: 'POST',
        url: `/api/v1/open-calls/${CALL_ID}/applications`,
        body: { message: 'Kaleci olarak gelirim' },
      },
      { method: 'GET', url: `/api/v1/open-calls/${CALL_ID}/applications?limit=50`, body: null },
      {
        method: 'PATCH',
        url: `/api/v1/open-calls/${CALL_ID}/applications/${APP_ID}`,
        body: { status: 'accepted' },
      },
      { method: 'PATCH', url: `/api/v1/matches/${MATCH_ID}/open-call`, body: { status: 'closed' } },
      {
        method: 'POST',
        url: `/api/v1/matches/${MATCH_ID}/open-call`,
        body: {
          missingCount: 2,
          position: null,
          level: 'regular',
          expiresAt: '2026-10-06T17:00:00.000Z',
        },
      },
    ]);
    // The public lists carry the bearer when signed in; the district list never does.
    expect(requests[0]?.authorization).toMatch(/^Bearer /);
    expect(requests[2]?.authorization).toBeNull();
  });
});

describe('form rules mirror the contracts', () => {
  it('uses the contract limits and value lists', () => {
    expect(APPLICATION_MESSAGE_MAX).toBe(LIMITS.applicationMessage.max);
    expect(CALL_MIN_LIFETIME_MS).toBe(LIMITS.openCallMinLifetimeSeconds * 1000);
    expect(MISSING_COUNT_MAX).toBe(LIMITS.missingCount.max);
    expect(LEVEL_OPTIONS).toEqual(LEVELS);
    expect(POSITION_OPTIONS).toEqual(POSITIONS);
  });

  it('accepts exactly the messages the server accepts', () => {
    const samples = [
      '',
      '   ',
      'Kaleci olarak gelirim',
      '  iki satır\r\nmesaj  ',
      'a'.repeat(280),
      'a'.repeat(281),
      `${'a'.repeat(279)}⚽`,
      'gizli​karakter',
      'zil\u0007sesi',
      'satır ayırıcı',
    ];
    for (const sample of samples) {
      const message = normalizeMessage(sample);
      const server = createApplicationRequestSchema.safeParse(
        message === undefined ? {} : { message: sample },
      );
      expect(messageIssue(sample) === null, JSON.stringify(sample)).toBe(server.success);
      if (server.success) {
        expect(server.data.message, JSON.stringify(sample)).toBe(message);
      }
    }
  });

  it('offers only expiry choices inside [now + 15 min, start], one hour before by default', () => {
    const startsAt = new Date(NOW + 2 * HOUR).toISOString();
    expect(availableExpiries(startsAt, NOW)).toEqual(['kickoff', 'hour1']);
    expect(defaultExpiry(startsAt, NOW)).toBe('hour1');
    const soon = new Date(NOW + 30 * 60 * 1000).toISOString();
    expect(availableExpiries(soon, NOW)).toEqual(['kickoff']);
    expect(defaultExpiry(soon, NOW)).toBe('kickoff');
    const tooSoon = new Date(NOW + CALL_MIN_LIFETIME_MS + EXPIRY_SLACK_MS - 1).toISOString();
    expect(availableExpiries(tooSoon, NOW)).toEqual([]);
    expect(defaultExpiry(tooSoon, NOW)).toBeNull();
    const far = new Date(NOW + 72 * HOUR).toISOString();
    expect(availableExpiries(far, NOW)).toEqual(['kickoff', 'hour1', 'hours3', 'hours24']);
    for (const choice of availableExpiries(far, NOW)) {
      const at = expiryInstant(far, choice);
      expect(at).toBeLessThanOrEqual(Date.parse(far));
      expect(at).toBeGreaterThanOrEqual(NOW + CALL_MIN_LIFETIME_MS);
      expect(
        publishOpenCallRequestSchema.safeParse({
          missingCount: 1,
          position: null,
          level: 'casual',
          expiresAt: new Date(at).toISOString(),
        }).success,
      ).toBe(true);
    }
  });

  it('offers publishing exactly when an expiry can be chosen (one threshold)', () => {
    for (let minutes = 0; minutes <= 30; minutes += 0.5) {
      const startsAt = new Date(NOW + minutes * 60 * 1000).toISOString();
      const blocked = publishBlocker('captain', false, matchFacts({ startsAt }), NOW) === 'tooLate';
      expect(blocked, `${minutes} min`).toBe(availableExpiries(startsAt, NOW).length === 0);
    }
  });

  it('checks the missing count against the free places', () => {
    expect(missingIssue(1, 4)).toBeNull();
    expect(missingIssue(4, 4)).toBeNull();
    expect(missingIssue(5, 4)).toBe('validation.missingInvalid');
    expect(missingIssue(0, 4)).toBe('validation.missingInvalid');
    expect(missingIssue(null, 4)).toBe('validation.missingInvalid');
  });

  it('finds districts by name or province, Turkish letters folded', () => {
    const list = [
      district('d1', 'Kadıköy', 'İstanbul'),
      district('d2', 'Üsküdar', 'İstanbul'),
      district('d3', 'Çankaya', 'Ankara'),
      district('d4', 'Kartal', 'İstanbul'),
    ];
    expect(searchDistricts(list, 'k').map((entry) => entry.id)).toEqual([]);
    expect(searchDistricts(list, 'kadi').map((entry) => entry.id)).toEqual(['d1']);
    expect(searchDistricts(list, 'usk').map((entry) => entry.id)).toEqual(['d2']);
    expect(searchDistricts(list, 'ÇAN').map((entry) => entry.id)).toEqual(['d3']);
    expect(searchDistricts(list, 'ka').map((entry) => entry.id)).toEqual(['d1', 'd4']);
    expect(searchDistricts(list, 'ist').map((entry) => entry.id)).toEqual(['d1', 'd2', 'd4']);
    expect(districtLabel(list, 'd1')).toBe('Kadıköy, İstanbul');
    expect(districtLabel(list, 'nope')).toBeNull();
    expect(districtLabel(undefined, 'd1')).toBeNull();
  });
});

describe('permissions (matrix §3.5)', () => {
  it('lets only staff publish, for an open match with time and a free place (footnote 19)', () => {
    expect(publishBlocker('captain', false, matchFacts(), NOW)).toBeNull();
    expect(publishBlocker('co_captain', false, matchFacts(), NOW)).toBeNull();
    expect(publishBlocker('player', false, matchFacts(), NOW)).toBe('notStaff');
    expect(publishBlocker(null, false, matchFacts(), NOW)).toBe('notStaff');
    expect(publishBlocker('captain', true, matchFacts(), NOW)).toBe('proLocked');
    for (const status of ['draft', 'locked', 'played', 'cancelled'] as const) {
      expect(publishBlocker('captain', false, matchFacts({ status }), NOW)).toBe('notOpen');
    }
    const soon = new Date(NOW + CALL_MIN_LIFETIME_MS - 1).toISOString();
    expect(publishBlocker('captain', false, matchFacts({ startsAt: soon }), NOW)).toBe('tooLate');
    const full = matchFacts({ counts: { in: 14, maybe: 0, out: 0, waitlist: 0 } });
    expect(publishBlocker('captain', false, full, NOW)).toBe('full');
    expect(freeSlots(matchFacts())).toBe(4);
    expect(maxMissingCount(matchFacts())).toBe(4);
    expect(
      maxMissingCount(matchFacts({ slots: 30, counts: { in: 0, maybe: 0, out: 0, waitlist: 0 } })),
    ).toBe(29);
  });

  it('reads the relationship from the applications answer (footnote 33)', () => {
    expect(callRelation({ items: [], nextCursor: null, related: false }, ME_ID)).toEqual({
      kind: 'none',
    });
    expect(callRelation({ items: [], nextCursor: null, related: true }, ME_ID)).toEqual({
      kind: 'staff',
    });
    expect(
      callRelation({ items: [application(OTHER_ID)], nextCursor: null, related: true }, ME_ID),
    ).toEqual({ kind: 'staff' });
    const own = application(ME_ID);
    expect(callRelation({ items: [own], nextCursor: null, related: true }, ME_ID)).toEqual({
      kind: 'applicant',
      application: own,
    });
  });

  it('decides and withdraws only pending applications of an active call (footnotes 21, 22)', () => {
    expect(canDecide({ status: 'pending' }, true)).toBe(true);
    expect(canDecide({ status: 'pending' }, false)).toBe(false);
    for (const status of ['accepted', 'rejected', 'withdrawn'] as const) {
      expect(canDecide({ status }, true)).toBe(false);
      expect(canWithdraw({ status })).toBe(false);
    }
    expect(canWithdraw({ status: 'pending' })).toBe(true);
    expect(callActive(publicCall(), NOW)).toBe(true);
    expect(callActive(publicCall({ expiresAt: new Date(NOW).toISOString() }), NOW)).toBe(false);
    expect(
      callActive(
        publicCall({
          expiresAt: new Date(NOW + HOUR).toISOString(),
          startsAt: new Date(NOW - 1).toISOString(),
        }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe('queries', () => {
  it('finds a call in any cached list, the newest list first, and remembers it', async () => {
    const client = new QueryClient();
    client.setQueryData(callKeys.list(NO_FILTERS), {
      pages: [{ items: [publicCall({ missingCount: 3 })], nextCursor: null }],
      pageParams: [undefined],
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    client.setQueryData(callKeys.list({ ...NO_FILTERS, level: 'regular' }), {
      pages: [{ items: [publicCall({ missingCount: 1 })], nextCursor: null }],
      pageParams: [undefined],
    });
    expect(findListedCall(client, CALL_ID)?.missingCount).toBe(1);
    expect(findListedCall(client, 'other')).toBeUndefined();
    expect(
      findListedCallForMatch(client, {
        team: { name: 'Moda Gençlik' },
        startsAt: '2026-10-06T18:00:00Z',
      })?.id,
    ).toBe(CALL_ID);
    expect(
      findListedCallForMatch(client, { team: { name: 'Başka' }, startsAt: '2026-10-06T18:00:00Z' }),
    ).toBeUndefined();
    expect(await client.fetchQuery(openCallQuery(client, CALL_ID))).toMatchObject({
      missingCount: 1,
    });
    client.removeQueries({ queryKey: callKeys.lists() });
    // No longer listed: the copy kept for the detail stays.
    expect(
      await client.fetchQuery({ ...openCallQuery(client, CALL_ID), staleTime: 0 }),
    ).toMatchObject({
      missingCount: 1,
    });
    expect(await client.fetchQuery(openCallQuery(client, 'unknown'))).toBeNull();
  });

  it('turns a 404 on the applications into "no relationship" and keeps other failures', async () => {
    const { api, session } = createTestApi();
    await session.establish(issueTokens());
    const calls = createCallsApi(api);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mswServer.use(
      http.get(apiUrl(`/api/v1/open-calls/${CALL_ID}/applications`), () =>
        problem(404, 'not_found'),
      ),
    );
    const none = await client.fetchInfiniteQuery(applicationsQuery(calls, CALL_ID));
    expect(none.pages[0]).toEqual({ items: [], nextCursor: null, related: false });
    mswServer.use(
      http.get(apiUrl(`/api/v1/open-calls/${CALL_ID}/applications`), () =>
        problem(403, 'forbidden'),
      ),
    );
    await expect(
      client.fetchInfiniteQuery({ ...applicationsQuery(calls, CALL_ID), staleTime: 0 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('persists lists, calls and districts, never applications or the staff view', () => {
    for (const key of [callKeys.list(NO_FILTERS), callKeys.call(CALL_ID), callKeys.districts()]) {
      expect(
        shouldPersistQuery({
          queryKey: key,
          state: { status: 'success', data: { items: [] } },
        } as never),
        JSON.stringify(key),
      ).toBe(true);
    }
    expect([...PERSISTED_QUERY_ROOTS]).not.toContain(OPEN_CALL_PRIVATE_ROOT);
    // What the persister would write: the dehydrated state with the app's persist options.
    const client = new QueryClient();
    client.setQueryData(callKeys.list(NO_FILTERS), {
      pages: [{ items: [publicCall()], nextCursor: null }],
      pageParams: [undefined],
    });
    client.setQueryData(callKeys.applications(CALL_ID), {
      pages: [
        {
          items: [application(OTHER_ID, { message: 'Numaram 0555 000 00 00' })],
          nextCursor: null,
          related: true,
        },
      ],
      pageParams: [undefined],
    });
    client.setQueryData(callKeys.matchCall(MATCH_ID), { id: CALL_ID, matchId: MATCH_ID });
    const storage = {
      getItem: () => Promise.resolve(null),
      setItem: () => Promise.resolve(),
      removeItem: () => Promise.resolve(),
    };
    const options = persistOptions(createQueryPersister(storage), 'v1:test');
    const state = dehydrate(client, options.dehydrateOptions);
    expect(state.queries.map((query) => query.queryKey[0])).toEqual(['open-calls']);
    expect(JSON.stringify(state)).not.toContain('0555');
  });

  it('builds routes outside the district link path', () => {
    expect(callHref(CALL_ID)).toBe(`/ilan/${CALL_ID}`);
    expect(matchCallHref(MATCH_ID)).toBe(`/ilan/mac/${MATCH_ID}`);
  });
});
