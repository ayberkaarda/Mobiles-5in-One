import {
  ERROR_CODES,
  ERROR_STATUS,
  ERROR_TITLES,
  type ErrorCode,
  problemDetailsSchema,
} from '@kadro/contracts';
import { DrizzleQueryError } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  ApiError,
  apiErrorFromDatabase,
  PROBLEM_TITLES,
  problemBody,
  problemResponse,
  toApiError,
} from '../lib/server/errors';
import { json, route } from '../lib/server/http';
import { noParams, noQuery } from '../lib/server/validate';
import { call, expectProblem, MOBILE } from './support/http';
import { installTestRuntime, type TestRuntime } from './support/runtime';

/** Shape of a `pg.DatabaseError` as seen by the mapper (structural, no driver import needed). */
function pgError(code: string, constraint?: string): Error {
  return Object.assign(new Error('driver message with value user@example.test'), {
    code,
    severity: 'ERROR',
    constraint,
    detail: 'Key (email)=(user@example.test) already exists.',
  });
}

function drizzleFailure(cause: Error): DrizzleQueryError {
  return new DrizzleQueryError(
    'insert into "users" ("email", "password_hash") values ($1, $2)',
    ['user@example.test', '$argon2id$v=19$m=65536,t=3,p=1$AAAA$BBBB'],
    cause,
  );
}

let harness: TestRuntime;

beforeAll(async () => {
  harness = await installTestRuntime();
});

describe('ApiError', () => {
  it('takes its status from ERROR_STATUS for every code', () => {
    for (const code of ERROR_CODES) {
      const error = new ApiError(code);
      expect(error.status).toBe(ERROR_STATUS[code]);
      expect(PROBLEM_TITLES[code].length).toBeGreaterThan(0);
    }
  });

  it('builds an RFC 9457 body that matches the contracts schema', () => {
    const body = problemBody('not_found', 'f3b1c2d4-0000-4000-8000-000000000001');
    expect(problemDetailsSchema.parse(body)).toEqual({
      type: 'https://kadro.app/problems/not_found',
      title: 'Not found',
      status: 404,
      code: 'not_found',
      requestId: 'f3b1c2d4-0000-4000-8000-000000000001',
    });
  });

  it('only attaches field errors to validation_failed', () => {
    const errors = [{ path: 'body.email', issue: 'invalid_format' }];
    expect(problemBody('forbidden', 'r', errors)).not.toHaveProperty('errors');
    expect(problemBody('validation_failed', 'r', errors).errors).toEqual(errors);
  });

  it('carries existingSlug on venue_exists only (ADR-0038)', async () => {
    const extensions = { existingSlug: 'moda-hali-saha-kadikoy' };
    const body = problemBody('venue_exists', 'r', undefined, extensions);
    expect(problemDetailsSchema.parse(body).existingSlug).toBe('moda-hali-saha-kadikoy');
    expect(problemBody('conflict', 'r', undefined, extensions)).not.toHaveProperty('existingSlug');
    expect(problemBody('venue_exists', 'r')).not.toHaveProperty('existingSlug');
    const response = problemResponse(new ApiError('venue_exists', { extensions }), 'abc');
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'venue_exists', ...extensions });
  });

  it('serializes with problem+json, no-store and nosniff', async () => {
    const response = problemResponse(
      new ApiError('rate_limited', { headers: { 'Retry-After': '30' } }),
      'abc',
    );
    expect(response.status).toBe(429);
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('retry-after')).toBe('30');
    expect(await response.json()).toMatchObject({ code: 'rate_limited', requestId: 'abc' });
  });
});

describe('database error mapping', () => {
  it('maps the ADR-0004 trigger to match_terms_frozen', () => {
    expect(
      apiErrorFromDatabase(drizzleFailure(pgError('23514', 'matches_terms_frozen')))?.code,
    ).toBe('match_terms_frozen');
  });

  it('maps named unique constraints to their domain codes', () => {
    const error = pgError('23505', 'open_call_applications_open_call_id_user_id_key');
    expect(apiErrorFromDatabase(drizzleFailure(error))?.code).toBe('already_applied');
    const member = pgError('23505', 'team_members_team_id_user_id_key');
    expect(apiErrorFromDatabase(member)?.code).toBe('already_participant');
  });

  it('maps any other unique violation to conflict', () => {
    expect(apiErrorFromDatabase(pgError('23505', 'users_email_lower_key'))?.code).toBe('conflict');
  });

  it('maps transient failures to 503 with Retry-After', () => {
    for (const code of ['40001', '40P01', '57014']) {
      const mapped = apiErrorFromDatabase(drizzleFailure(pgError(code)));
      expect(mapped?.code).toBe('service_unavailable');
      expect(mapped?.headers['Retry-After']).toBe('1');
    }
  });

  it('leaves unexpected failures unmapped so they become 500', () => {
    expect(apiErrorFromDatabase(pgError('23503', 'teams_owner_id_users_id_fk'))).toBeNull();
    expect(apiErrorFromDatabase(pgError('23514', 'matches_slots_range'))).toBeNull();
    expect(apiErrorFromDatabase(new Error('not a database error'))).toBeNull();
    expect(toApiError(new TypeError('x')).code).toBe('internal_error');
  });

  it('does not treat an arbitrary object with a code as a database error', () => {
    expect(apiErrorFromDatabase({ code: '23505' })).toBeNull();
  });
});

describe('Phase 2 error codes (handoff contracts-to-web-001)', () => {
  const CONFLICTS = [
    'invalid_status_transition',
    'match_state_conflict',
    'player_not_confirmed',
    'mvp_vote_closed',
    'already_voted',
    'invalid_votee',
    'open_call_exists',
    'invalid_missing_count',
    'invalid_call_expiry',
    'already_reviewed',
    'deletion_pending',
    'invite_limit',
    'lineup_side_full',
    'venue_exists',
    'upload_not_pending',
  ] as const;
  const EXPECTED: readonly (readonly [ErrorCode, number])[] = [
    ...CONFLICTS.map((code) => [code, 409] as const),
    ['review_not_eligible', 403],
    ['invalid_cursor', 400],
  ];

  it('covers all 17 new codes', () => {
    expect(EXPECTED).toHaveLength(17);
    for (const [code] of EXPECTED) {
      expect(ERROR_CODES).toContain(code);
    }
  });

  it('uses the contracts titles for every code', () => {
    for (const code of ERROR_CODES) {
      expect(PROBLEM_TITLES[code]).toBe(ERROR_TITLES[code]);
    }
  });

  for (const [code, status] of EXPECTED) {
    it(`answers ${code} with ${status} through the route wrapper`, async () => {
      const thrower = route({
        path: '/api/v1/test/domain',
        method: 'GET',
        auth: 'none',
        params: noParams,
        query: noQuery,
        body: null,
        handler: () => {
          throw new ApiError(code);
        },
      });
      const body = await expectProblem(await call(thrower, { headers: MOBILE }), status, code);
      expect(body.title).toBe(ERROR_TITLES[code]);
      expect(body.type).toBe(`https://kadro.app/problems/${code}`);
    });
  }

  it('maps the Phase 2 constraints to their domain codes and statuses', () => {
    const cases = [
      ['23505', 'open_calls_one_open_per_match_key', 'open_call_exists'],
      ['23505', 'venue_reviews_venue_id_user_id_key', 'already_reviewed'],
      ['23505', 'mvp_votes_match_id_voter_id_key', 'already_voted'],
      ['23505', 'deletion_requests_pending_user_key', 'deletion_pending'],
      ['23514', 'mvp_votes_no_self_vote', 'invalid_votee'],
    ] as const;
    for (const [sqlState, constraint, code] of cases) {
      const mapped = apiErrorFromDatabase(drizzleFailure(pgError(sqlState, constraint)));
      expect(mapped?.code, constraint).toBe(code);
      expect(mapped?.status, constraint).toBe(409);
    }
  });
});

describe('forced 500 through the route wrapper', () => {
  const sensitive =
    'connect ECONNREFUSED at /srv/kadro/apps/web/lib/server/db.ts:12 SELECT password_hash FROM users';

  const crashing = route({
    path: '/api/v1/test/crash',
    method: 'GET',
    auth: 'none',
    params: noParams,
    query: noQuery,
    body: null,
    handler: () => {
      throw new Error(sensitive);
    },
  });

  const databaseCrash = route({
    path: '/api/v1/test/db-crash',
    method: 'GET',
    auth: 'none',
    params: noParams,
    query: noQuery,
    body: null,
    handler: () => {
      throw drizzleFailure(pgError('23503', 'teams_owner_id_users_id_fk'));
    },
  });

  it('returns only the generic problem fields and the request id', async () => {
    const response = await call(crashing, { headers: MOBILE });
    const text = await response.clone().text();
    const body = await expectProblem(response, 500, 'internal_error');
    expect(Object.keys(body).sort()).toEqual(['code', 'requestId', 'status', 'title', 'type']);
    expect(body.title).toBe('Internal server error');
    for (const leak of [
      'ECONNREFUSED',
      '/srv/',
      'db.ts',
      'SELECT',
      'password_hash',
      'stack',
      'at ',
    ]) {
      expect(text).not.toContain(leak);
    }
  });

  it('logs the failure server-side with the same request id', async () => {
    const response = await call(crashing, { headers: MOBILE });
    const requestId = response.headers.get('x-request-id');
    const line = harness.logLines.find(
      (entry) =>
        entry.includes(`"requestId":"${requestId ?? ''}"`) &&
        entry.includes('"msg":"request failed"'),
    );
    expect(line).toBeDefined();
    const record = JSON.parse(line ?? '{}') as {
      level: number;
      msg: string;
      err?: { type: string; message: string };
    };
    expect(record.level).toBe(50);
    expect(record.msg).toBe('request failed');
    expect(record.err?.message).toContain('ECONNREFUSED');
  });

  it('never logs SQL text, bound parameters or offending values of database errors', async () => {
    const response = await call(databaseCrash, { headers: MOBILE });
    await expectProblem(response, 500, 'internal_error');
    const requestId = response.headers.get('x-request-id') ?? '';
    const line =
      harness.logLines.find(
        (entry) => entry.includes(requestId) && entry.includes('"msg":"request failed"'),
      ) ?? '';
    expect(line).toContain('"sqlState":"23503"');
    expect(line).toContain('teams_owner_id_users_id_fk');
    for (const leak of ['user@example.test', 'argon2id', 'insert into', 'Key (email)']) {
      expect(line).not.toContain(leak);
    }
  });

  it('maps a database conflict thrown by a handler to its problem code', async () => {
    const conflicting = route({
      path: '/api/v1/test/conflict',
      method: 'GET',
      auth: 'none',
      params: noParams,
      query: noQuery,
      body: null,
      handler: () => {
        throw drizzleFailure(pgError('23514', 'matches_terms_frozen'));
      },
    });
    await expectProblem(await call(conflicting, { headers: MOBILE }), 409, 'match_terms_frozen');
  });

  it('passes successful responses through with the API headers', async () => {
    const ok = route({
      path: '/api/v1/test/ok',
      method: 'GET',
      auth: 'none',
      params: noParams,
      query: noQuery,
      body: null,
      handler: () => json({ ok: true }, { status: 201 }),
    });
    const response = await call(ok, { headers: MOBILE });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({ ok: true });
  });
});
