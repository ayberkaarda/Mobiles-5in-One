import { describe, expect, it } from 'vitest';

import {
  ACCESS_TOKEN_AUDIENCE,
  ACTIONS,
  accessTokenClaimsSchema,
  ERROR_CODES,
  ERROR_STATUS,
  LIMITS,
  ROLES,
  acceptedResponseSchema,
  appleSignInRequestSchema,
  districtPublicSchema,
  forgotPasswordRequestSchema,
  googleSignInRequestSchema,
  healthResponseSchema,
  loginRequestSchema,
  LOGOUT_REQUEST_SCHEMAS,
  LEVELS,
  REFRESH_REQUEST_SCHEMAS,
  authClientSchema,
  mobileLogoutRequestSchema,
  mobileRefreshResponseSchema,
  webRefreshResponseSchema,
  meResponseSchema,
  mobileAuthResponseSchema,
  NO_ENTITLEMENTS,
  paginatedResponseSchema,
  paginationQuerySchema,
  problemDetailsSchema,
  problemTypeFor,
  mobileRefreshRequestSchema,
  registerPushTokenRequestSchema,
  registerRequestSchema,
  resetPasswordRequestSchema,
  updateMeRequestSchema,
  userPublicSchema,
  verifyEmailRequestSchema,
  webAuthResponseSchema,
} from './index.js';

const USER_ID = '01920b7c-3c1e-7a4b-8f2d-5e6a7b8c9d0e';
const DISTRICT_ID = '01920b7c-3c1e-7c4b-9f2d-5e6a7b8c9d0f';
const TOKEN = 'A'.repeat(43);
const JWS = 'eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl';
const NOW = '2026-10-01T10:00:00.000Z';

function ok(schema: { safeParse: (value: unknown) => { success: boolean } }, value: unknown) {
  return schema.safeParse(value).success;
}

describe('problemDetailsSchema', () => {
  const problem = {
    type: problemTypeFor('validation_failed'),
    title: 'Validation failed',
    status: 400,
    code: 'validation_failed',
    requestId: '01J9Z6Q4V7W2K8M3N5P6R7S8T9',
  };

  it('accepts a minimal RFC 9457 body and field errors without values', () => {
    expect(problemDetailsSchema.parse(problem)).toEqual(problem);
    expect(
      ok(problemDetailsSchema, {
        ...problem,
        errors: [{ path: 'displayName', issue: 'too_small' }],
      }),
    ).toBe(true);
  });

  it('rejects unknown keys such as leaked stack traces', () => {
    expect(ok(problemDetailsSchema, { ...problem, stack: 'Error: at db.ts:12' })).toBe(false);
    expect(
      ok(problemDetailsSchema, {
        ...problem,
        errors: [{ path: 'password', issue: 'too_small', received: 'hunter2' }],
      }),
    ).toBe(false);
  });

  it('rejects non-error status codes and unknown error codes', () => {
    expect(ok(problemDetailsSchema, { ...problem, status: 200 })).toBe(false);
    expect(ok(problemDetailsSchema, { ...problem, status: 600 })).toBe(false);
    expect(ok(problemDetailsSchema, { ...problem, code: 'sql_error' })).toBe(false);
  });

  it('requires an https type URI and a request id', () => {
    expect(ok(problemDetailsSchema, { ...problem, type: 'about:blank' })).toBe(false);
    expect(ok(problemDetailsSchema, { ...problem, requestId: '' })).toBe(false);
  });

  it('maps every error code to an error status', () => {
    for (const code of ERROR_CODES) {
      const status = ERROR_STATUS[code];
      expect(status).toBeGreaterThanOrEqual(400);
      expect(
        ok(problemDetailsSchema, { ...problem, code, status, type: problemTypeFor(code) }),
      ).toBe(true);
    }
    expect(ERROR_STATUS.not_found).toBe(404);
    expect(ERROR_STATUS.rate_limited).toBe(429);
    expect(ERROR_STATUS.step_up_required).toBe(401);
    expect(ERROR_STATUS.reauth_required).toBe(401);
    for (const code of [
      'totp_not_enrolled',
      'match_terms_frozen',
      'lineup_invalid_player',
      'already_applied',
      'application_not_pending',
      'call_closed',
      'match_not_open',
      'already_participant',
    ] as const) {
      expect(ERROR_CODES).toContain(code);
      expect(ERROR_STATUS[code]).toBe(409);
    }
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });
});

describe('healthResponseSchema', () => {
  const body = {
    status: 'ok',
    service: 'kadro-web',
    environment: 'local',
    buildSha: 'local',
    time: NOW,
  };

  it('accepts a well-formed health payload', () => {
    expect(healthResponseSchema.parse(body)).toEqual(body);
  });

  it('rejects extra fields', () => {
    expect(ok(healthResponseSchema, { ...body, databaseUrl: 'postgres://example' })).toBe(false);
  });
});

describe('roles and actions', () => {
  it('lists the six policy roles', () => {
    expect(ROLES).toEqual(['guest', 'player', 'co_captain', 'captain', 'moderator', 'admin']);
  });

  it('contains every action named by security checklist item 3 without duplicates', () => {
    for (const action of [
      'team.update',
      'team.delete',
      'member.remove',
      'match.create',
      'match.update',
      'lineup.set',
      'payment.mark',
      'opencall.publish',
      'application.decide',
      'venue.verify',
      'review.delete',
    ]) {
      expect(ACTIONS).toContain(action);
    }
    expect(ACTIONS.some((action) => action.startsWith('admin.'))).toBe(true);
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length);
  });
});

describe('registerRequestSchema', () => {
  const body = { email: 'Oyuncu@Example.com ', password: 'a'.repeat(10), displayName: ' Ayşe ' };

  it('normalizes email and display name', () => {
    expect(registerRequestSchema.parse(body)).toEqual({
      email: 'oyuncu@example.com',
      password: 'a'.repeat(10),
      displayName: 'Ayşe',
    });
  });

  it('enforces password length bounds', () => {
    expect(
      ok(registerRequestSchema, { ...body, password: 'a'.repeat(LIMITS.password.min - 1) }),
    ).toBe(false);
    expect(ok(registerRequestSchema, { ...body, password: 'a'.repeat(LIMITS.password.max) })).toBe(
      true,
    );
    expect(
      ok(registerRequestSchema, { ...body, password: 'a'.repeat(LIMITS.password.max + 1) }),
    ).toBe(false);
  });

  it('enforces display name length bounds after trimming', () => {
    expect(ok(registerRequestSchema, { ...body, displayName: 'A' })).toBe(false);
    expect(ok(registerRequestSchema, { ...body, displayName: '  A  ' })).toBe(false);
    expect(ok(registerRequestSchema, { ...body, displayName: 'Ab' })).toBe(true);
    expect(ok(registerRequestSchema, { ...body, displayName: 'a'.repeat(40) })).toBe(true);
    expect(ok(registerRequestSchema, { ...body, displayName: 'a'.repeat(41) })).toBe(false);
  });

  it('rejects control and bidi override characters in display names', () => {
    expect(ok(registerRequestSchema, { ...body, displayName: 'Ali\u0000Veli' })).toBe(false);
    const rightToLeftOverride = String.fromCodePoint(0x202e);
    expect(ok(registerRequestSchema, { ...body, displayName: `Ali${rightToLeftOverride}x` })).toBe(
      false,
    );
  });

  it('rejects invalid and oversized emails', () => {
    expect(ok(registerRequestSchema, { ...body, email: 'not-an-email' })).toBe(false);
    expect(ok(registerRequestSchema, { ...body, email: `${'a'.repeat(250)}@example.com` })).toBe(
      false,
    );
  });

  it('rejects mass-assignment of server-only fields', () => {
    for (const extra of [{ role: 'admin' }, { emailVerified: true }, { id: USER_ID }]) {
      expect(ok(registerRequestSchema, { ...body, ...extra })).toBe(false);
    }
  });

  it('rejects wrong types', () => {
    expect(ok(registerRequestSchema, { ...body, password: 1234567890 })).toBe(false);
    expect(ok(registerRequestSchema, null)).toBe(false);
    expect(ok(registerRequestSchema, [body])).toBe(false);
  });
});

describe('auth request schemas', () => {
  it('login accepts any non-empty password up to the maximum', () => {
    expect(ok(loginRequestSchema, { email: 'a@b.co', password: 'x' })).toBe(true);
    expect(ok(loginRequestSchema, { email: 'a@b.co', password: '' })).toBe(false);
    expect(ok(loginRequestSchema, { email: 'a@b.co', password: 'x'.repeat(129) })).toBe(false);
    expect(ok(loginRequestSchema, { email: 'a@b.co', password: 'x', remember: true })).toBe(false);
    expect(
      ok(loginRequestSchema, { email: 'a@b.co', password: 'x', deviceLabel: 'd'.repeat(65) }),
    ).toBe(false);
  });

  it('opaque tokens must be base64url within bounds', () => {
    expect(ok(mobileRefreshRequestSchema, { refreshToken: TOKEN })).toBe(true);
    expect(ok(mobileRefreshRequestSchema, { refreshToken: TOKEN.slice(0, 42) })).toBe(false);
    expect(ok(mobileRefreshRequestSchema, { refreshToken: 'a'.repeat(129) })).toBe(false);
    expect(ok(mobileRefreshRequestSchema, { refreshToken: `${TOKEN}/=` })).toBe(false);
    expect(ok(verifyEmailRequestSchema, { token: TOKEN, email: 'a@b.co' })).toBe(false);
  });

  it('selects refresh and logout bodies by client', () => {
    expect(ok(LOGOUT_REQUEST_SCHEMAS.web, {})).toBe(true);
    expect(ok(LOGOUT_REQUEST_SCHEMAS.web, { refreshToken: TOKEN })).toBe(false);
    expect(ok(LOGOUT_REQUEST_SCHEMAS.mobile, { refreshToken: TOKEN })).toBe(true);
    expect(ok(mobileLogoutRequestSchema, {})).toBe(false);
    expect(ok(mobileLogoutRequestSchema, { refreshToken: TOKEN, allDevices: true })).toBe(false);
    expect(ok(REFRESH_REQUEST_SCHEMAS.web, {})).toBe(true);
    expect(ok(REFRESH_REQUEST_SCHEMAS.web, { refreshToken: TOKEN })).toBe(false);
    expect(ok(REFRESH_REQUEST_SCHEMAS.mobile, {})).toBe(false);
  });

  it('accepts only the two stored client kinds', () => {
    expect(authClientSchema.options).toEqual(['mobile', 'web']);
    expect(ok(authClientSchema, 'desktop')).toBe(false);
  });

  it('refresh responses never mix transports', () => {
    expect(ok(webRefreshResponseSchema, { csrfToken: TOKEN })).toBe(true);
    expect(ok(webRefreshResponseSchema, { csrfToken: TOKEN, refreshToken: TOKEN })).toBe(false);
    expect(ok(mobileRefreshResponseSchema, { csrfToken: TOKEN })).toBe(false);
  });

  it('forgot and reset apply the same email and password rules', () => {
    expect(ok(forgotPasswordRequestSchema, { email: 'a@b.co' })).toBe(true);
    expect(ok(forgotPasswordRequestSchema, { email: 'a@b.co', redirect: 'https://x' })).toBe(false);
    expect(ok(resetPasswordRequestSchema, { token: TOKEN, password: 'a'.repeat(10) })).toBe(true);
    expect(ok(resetPasswordRequestSchema, { token: TOKEN, password: 'a'.repeat(9) })).toBe(false);
  });

  it('apple sign-in requires a compact JWS and a bounded nonce', () => {
    const body = { identityToken: JWS, nonce: 'n'.repeat(LIMITS.nonce.min) };
    expect(ok(appleSignInRequestSchema, body)).toBe(true);
    expect(ok(appleSignInRequestSchema, { ...body, nonce: 'n'.repeat(15) })).toBe(false);
    expect(ok(appleSignInRequestSchema, { ...body, nonce: 'n'.repeat(129) })).toBe(false);
    expect(ok(appleSignInRequestSchema, { ...body, identityToken: 'header.payload' })).toBe(false);
    expect(ok(appleSignInRequestSchema, { identityToken: JWS })).toBe(false);
    expect(ok(appleSignInRequestSchema, { ...body, email: 'a@b.co' })).toBe(false);
  });

  it('google sign-in rejects oversized tokens and unknown keys', () => {
    expect(ok(googleSignInRequestSchema, { idToken: JWS })).toBe(true);
    expect(
      ok(googleSignInRequestSchema, { idToken: `${'a'.repeat(LIMITS.identityToken.max)}.b.c` }),
    ).toBe(false);
    expect(ok(googleSignInRequestSchema, { idToken: JWS, sub: '123' })).toBe(false);
  });
});

const me = {
  id: USER_ID,
  displayName: 'Ayşe',
  avatarUrl: null,
  position: 'MID',
  level: 'regular',
  email: 'ayse@example.com',
  emailVerified: true,
  role: 'user',
  districtId: DISTRICT_ID,
  providers: { password: true, apple: false, google: false },
  createdAt: NOW,
  entitlements: NO_ENTITLEMENTS,
};

describe('accessTokenClaimsSchema', () => {
  const claims = {
    sub: USER_ID,
    sid: '9b2f6c1e-3c1e-4a4b-8f2d-5e6a7b8c9d0e',
    iat: 1_790_000_000,
    exp: 1_790_000_900,
    aud: ACCESS_TOKEN_AUDIENCE,
    iss: 'https://kadro.app',
  };

  it('accepts the fixed claim set with a UUIDv4 or UUIDv7 session id', () => {
    expect(ok(accessTokenClaimsSchema, claims)).toBe(true);
    expect(ok(accessTokenClaimsSchema, { ...claims, sid: USER_ID })).toBe(true);
  });

  it('rejects extra claims, foreign audiences and malformed values', () => {
    expect(ok(accessTokenClaimsSchema, { ...claims, role: 'admin' })).toBe(false);
    expect(ok(accessTokenClaimsSchema, { ...claims, aud: 'other-api' })).toBe(false);
    expect(ok(accessTokenClaimsSchema, { ...claims, sid: 'family-1' })).toBe(false);
    expect(ok(accessTokenClaimsSchema, { ...claims, sub: claims.sid })).toBe(false);
    expect(ok(accessTokenClaimsSchema, { ...claims, iat: -1 })).toBe(false);
    expect(ok(accessTokenClaimsSchema, { ...claims, exp: 0 })).toBe(false);
    expect(ok(accessTokenClaimsSchema, { ...claims, exp: 1.5 })).toBe(false);
    expect(ok(accessTokenClaimsSchema, { ...claims, iss: '' })).toBe(false);
    const { sid: _sid, ...withoutSid } = claims;
    expect(ok(accessTokenClaimsSchema, withoutSid)).toBe(false);
  });
});

describe('auth response schemas', () => {
  it('accepts the mobile token response', () => {
    expect(
      ok(mobileAuthResponseSchema, {
        user: me,
        tokens: {
          tokenType: 'Bearer',
          accessToken: JWS,
          accessTokenExpiresAt: NOW,
          refreshToken: TOKEN,
          refreshTokenExpiresAt: NOW,
        },
      }),
    ).toBe(true);
  });

  it('never carries tokens in the web response', () => {
    expect(ok(webAuthResponseSchema, { user: me, csrfToken: TOKEN })).toBe(true);
    expect(ok(webAuthResponseSchema, { user: me, csrfToken: TOKEN, refreshToken: TOKEN })).toBe(
      false,
    );
  });

  it('accepted response has a single fixed shape', () => {
    expect(ok(acceptedResponseSchema, { status: 'accepted' })).toBe(true);
    expect(ok(acceptedResponseSchema, { status: 'accepted', exists: false })).toBe(false);
  });
});

describe('me schemas', () => {
  it('me response rejects internal fields', () => {
    expect(ok(meResponseSchema, me)).toBe(true);
    for (const extra of [
      { passwordHash: '$argon2id$' },
      { appleSub: '001' },
      { totpSecret: 'x' },
    ]) {
      expect(ok(meResponseSchema, { ...me, ...extra })).toBe(false);
    }
  });

  it('public user projection excludes email and role', () => {
    const publicUser = {
      id: USER_ID,
      displayName: 'Ayşe',
      avatarUrl: 'https://cdn.kadro.app/avatars/a.webp',
      position: null,
      level: null,
    };
    expect(ok(userPublicSchema, publicUser)).toBe(true);
    expect(ok(userPublicSchema, { ...publicUser, email: 'ayse@example.com' })).toBe(false);
    expect(ok(userPublicSchema, { ...publicUser, avatarUrl: 'http://cdn.kadro.app/a.webp' })).toBe(
      false,
    );
  });

  it('patch accepts only self-writable fields', () => {
    expect(ok(updateMeRequestSchema, { displayName: 'Mehmet' })).toBe(true);
    expect(ok(updateMeRequestSchema, { position: null, level: null, districtId: null })).toBe(true);
    expect(ok(updateMeRequestSchema, { districtId: DISTRICT_ID, position: 'GK' })).toBe(true);
    expect(ok(updateMeRequestSchema, {})).toBe(false);
    for (const extra of [
      { role: 'admin' },
      { email: 'x@y.z' },
      { avatarKey: 'avatars/other/1' },
      { emailVerified: true },
    ]) {
      expect(ok(updateMeRequestSchema, { displayName: 'Mehmet', ...extra })).toBe(false);
    }
  });

  it('patch validates enums and id format', () => {
    expect(ok(updateMeRequestSchema, { position: 'STRIKER' })).toBe(false);
    expect(LEVELS).toEqual(['casual', 'regular', 'competitive']);
    expect(ok(updateMeRequestSchema, { level: 'competitive' })).toBe(true);
    expect(ok(updateMeRequestSchema, { level: 'intermediate' })).toBe(false);
    expect(ok(updateMeRequestSchema, { districtId: '42' })).toBe(false);
    // UUIDv4 is not a valid primary key; all ids are UUIDv7.
    expect(ok(updateMeRequestSchema, { districtId: '9b2f6c1e-3c1e-4a4b-8f2d-5e6a7b8c9d0e' })).toBe(
      false,
    );
  });

  it('push token registration validates the Expo token format and platform', () => {
    const body = { expoToken: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]', platform: 'ios' };
    expect(ok(registerPushTokenRequestSchema, body)).toBe(true);
    expect(
      ok(registerPushTokenRequestSchema, { ...body, expoToken: 'ExpoPushToken[abc_DEF-123]' }),
    ).toBe(true);
    expect(ok(registerPushTokenRequestSchema, { ...body, expoToken: 'fcm:abc' })).toBe(false);
    expect(ok(registerPushTokenRequestSchema, { ...body, platform: 'web' })).toBe(false);
    expect(ok(registerPushTokenRequestSchema, { ...body, userId: USER_ID })).toBe(false);
  });
});

describe('districtPublicSchema', () => {
  const district = {
    id: DISTRICT_ID,
    province: 'İstanbul',
    provinceSlug: 'istanbul',
    name: 'Kadıköy',
    slug: 'kadikoy',
    centroid: { latitude: 40.99, longitude: 29.03 },
  };

  it('accepts a district and rejects invalid slugs and coordinates', () => {
    expect(ok(districtPublicSchema, district)).toBe(true);
    expect(ok(districtPublicSchema, { ...district, slug: 'Kadıköy' })).toBe(false);
    expect(ok(districtPublicSchema, { ...district, slug: 'kadikoy-' })).toBe(false);
    expect(
      ok(districtPublicSchema, { ...district, centroid: { latitude: 91, longitude: 0 } }),
    ).toBe(false);
    expect(ok(districtPublicSchema, { ...district, isSample: true })).toBe(false);
  });
});

describe('pagination', () => {
  it('defaults the page size and accepts boundary values', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ limit: LIMITS.pageSize.default });
    expect(paginationQuerySchema.parse({ limit: '1' }).limit).toBe(1);
    expect(paginationQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  });

  it('rejects out-of-range, non-integer and unknown parameters', () => {
    for (const limit of ['0', '101', '-1', '1.5', '1e2', '', 'abc']) {
      expect(ok(paginationQuerySchema, { limit })).toBe(false);
    }
    expect(ok(paginationQuerySchema, { offset: '10' })).toBe(false);
    expect(ok(paginationQuerySchema, { cursor: 'abc$' })).toBe(false);
    expect(ok(paginationQuerySchema, { cursor: 'a'.repeat(513) })).toBe(false);
  });

  it('wraps items in a strict envelope', () => {
    const schema = paginatedResponseSchema(userPublicSchema);
    expect(ok(schema, { items: [], nextCursor: null })).toBe(true);
    expect(ok(schema, { items: [], nextCursor: null, total: 0 })).toBe(false);
  });
});

describe('LIMITS', () => {
  it('matches the values fixed by security checklist item 6', () => {
    expect(LIMITS.feeTotalMinor).toEqual({ min: 0, max: 100_000_000 });
    expect(LIMITS.slots).toEqual({ min: 2, max: 30 });
    expect(LIMITS.displayName).toEqual({ min: 2, max: 40 });
    expect(LIMITS.password.min).toBe(10);
    expect(LIMITS.jsonBodyMaxBytes).toBe(1024 * 1024);
  });
});
