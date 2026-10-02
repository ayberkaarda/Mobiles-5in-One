import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { accepts, base64url, isoAt, uuidv4, uuidv7 } from './fixtures.test-helper.js';
import {
  adminTotpEnrollRequestSchema,
  adminTotpEnrollResponseSchema,
  APP_LINK_PATH_PATTERNS,
  APP_SCHEME,
  appDeepLink,
  auditLogEntrySchema,
  BILLING_JOB_PAYLOAD_SCHEMAS,
  BILLING_JOB_QUEUES,
  type DeepLinkTarget,
  deepLinkPath,
  entitlementsSchema,
  ERROR_CODES,
  grantsPro,
  isErrorCode,
  JOB_QUEUES,
  LIMITS,
  listDistrictsQuerySchema,
  listDistrictsResponseSchema,
  maskedEmailSchema,
  maskEmail,
  meResponseSchema,
  meStatsResponseSchema,
  mobileProblemAction,
  NO_ENTITLEMENTS,
  parseDeepLink,
  revenueCatWebhookBodySchema,
  revenueCatWebhookResponseSchema,
  setUserRoleRequestSchema,
  SUBSCRIPTION_STATUSES,
  updateAdminVenueRequestSchema,
  venueImportRequestSchema,
  webDeepLink,
} from './index.js';

function jws(): string {
  return `${base64url(20)}.${base64url(40)}.${base64url(30)}`;
}

describe('entitlements', () => {
  it('grants Pro exactly for active and grace_period', () => {
    expect(SUBSCRIPTION_STATUSES.filter(grantsPro)).toEqual(['active', 'grace_period']);
    for (const status of SUBSCRIPTION_STATUSES) {
      const value = { pro: grantsPro(status), status, expiresAt: isoAt(1_000), store: 'app_store' };
      expect(accepts(entitlementsSchema, value), status).toBe(true);
      expect(accepts(entitlementsSchema, { ...value, pro: !value.pro }), status).toBe(false);
    }
  });

  it('describes a user without subscription as none, without expiry or store', () => {
    expect(accepts(entitlementsSchema, NO_ENTITLEMENTS)).toBe(true);
    expect(accepts(entitlementsSchema, { ...NO_ENTITLEMENTS, store: 'play_store' })).toBe(false);
    expect(accepts(entitlementsSchema, { ...NO_ENTITLEMENTS, extra: true })).toBe(false);
  });

  it('keeps entitlements optional on the profile until every response carries them', () => {
    const me = {
      id: uuidv7(),
      displayName: 'Ayşe',
      avatarUrl: null,
      position: null,
      level: null,
      email: 'ayse@example.com',
      emailVerified: true,
      role: 'user',
      districtId: null,
      providers: { password: true, apple: false, google: false },
      createdAt: isoAt(),
    };
    expect(accepts(meResponseSchema, me)).toBe(true);
    expect(accepts(meResponseSchema, { ...me, entitlements: NO_ENTITLEMENTS })).toBe(true);
    expect(accepts(meResponseSchema, { ...me, entitlements: { pro: true } })).toBe(false);
  });
});

describe('profile statistics', () => {
  const basic = { matchesPlayed: 12, mvpCount: 3 };
  const advanced = {
    matchesPlayedLast30Days: 4,
    mvpRate: 0.25,
    attendanceRate: null,
    distinctVenues: 2,
    distinctTeams: 1,
  };

  it('returns the advanced block only on the full tier', () => {
    expect(accepts(meStatsResponseSchema, { tier: 'basic', ...basic })).toBe(true);
    expect(accepts(meStatsResponseSchema, { tier: 'full', ...basic, advanced })).toBe(true);
    expect(accepts(meStatsResponseSchema, { tier: 'basic', ...basic, advanced })).toBe(false);
    expect(accepts(meStatsResponseSchema, { tier: 'full', ...basic })).toBe(false);
    expect(
      accepts(meStatsResponseSchema, {
        tier: 'full',
        ...basic,
        advanced: { ...advanced, mvpRate: 1.5 },
      }),
    ).toBe(false);
  });
});

describe('districts', () => {
  it('filters by province slug only and bounds the list', () => {
    expect(accepts(listDistrictsQuerySchema, {})).toBe(true);
    expect(accepts(listDistrictsQuerySchema, { province: 'istanbul' })).toBe(true);
    expect(accepts(listDistrictsQuerySchema, { province: 'İstanbul' })).toBe(false);
    expect(accepts(listDistrictsQuerySchema, { limit: '10' })).toBe(false);
    const item = {
      id: uuidv7(),
      province: 'İstanbul',
      provinceSlug: 'istanbul',
      name: 'Kadıköy',
      slug: 'kadikoy',
      centroid: { latitude: 40.99, longitude: 29.03 },
    };
    expect(accepts(listDistrictsResponseSchema, { items: [item] })).toBe(true);
    const tooMany = Array.from({ length: LIMITS.districtsList.max + 1 }, () => item);
    expect(accepts(listDistrictsResponseSchema, { items: tooMany })).toBe(false);
  });
});

describe('RevenueCat webhook', () => {
  const event = () => ({
    id: uuidv4().toUpperCase(),
    type: 'INITIAL_PURCHASE',
    event_timestamp_ms: Date.now(),
    app_user_id: uuidv7(),
    product_id: 'kadro_pro_monthly',
    entitlement_ids: ['pro'],
    period_type: 'NORMAL',
    purchased_at_ms: Date.now(),
    expiration_at_ms: Date.now() + 30 * 86_400_000,
    store: 'APP_STORE',
    environment: 'SANDBOX',
  });

  it('keeps the envelope strict and the event open to new provider fields', () => {
    expect(accepts(revenueCatWebhookBodySchema, { api_version: '1.0', event: event() })).toBe(true);
    expect(
      accepts(revenueCatWebhookBodySchema, {
        api_version: '1.0',
        event: { ...event(), country_code: 'TR', is_family_share: false },
      }),
    ).toBe(true);
    expect(
      accepts(revenueCatWebhookBodySchema, { api_version: '1.0', event: event(), extra: 1 }),
    ).toBe(false);
    expect(accepts(revenueCatWebhookBodySchema, { event: event() })).toBe(false);
  });

  it('bounds and types the fields the server reads', () => {
    const body = (patch: Record<string, unknown>) => ({
      api_version: '1.0',
      event: { ...event(), ...patch },
    });
    expect(accepts(revenueCatWebhookBodySchema, body({ id: '' }))).toBe(false);
    expect(accepts(revenueCatWebhookBodySchema, body({ id: 'x'.repeat(129) }))).toBe(false);
    expect(accepts(revenueCatWebhookBodySchema, body({ event_timestamp_ms: -1 }))).toBe(false);
    expect(accepts(revenueCatWebhookBodySchema, body({ environment: 'STAGING' }))).toBe(false);
    expect(accepts(revenueCatWebhookBodySchema, body({ app_user_id: undefined }))).toBe(true);
    expect(accepts(revenueCatWebhookBodySchema, body({ expiration_at_ms: null }))).toBe(true);
    expect(accepts(revenueCatWebhookBodySchema, body({ type: 'SOMETHING_NEW' }))).toBe(true);
  });

  it('accepts empty descriptive provider strings so a delivery is never retried forever', () => {
    const body = (patch: Record<string, unknown>) => ({
      api_version: '1.0',
      event: { ...event(), ...patch },
    });
    expect(accepts(revenueCatWebhookBodySchema, body({ transaction_id: '' }))).toBe(true);
    expect(
      accepts(
        revenueCatWebhookBodySchema,
        body({
          original_transaction_id: '',
          product_id: '',
          period_type: '',
          store: '',
          original_app_user_id: '',
        }),
      ),
    ).toBe(true);
    expect(accepts(revenueCatWebhookBodySchema, body({ transaction_id: 'x'.repeat(201) }))).toBe(
      false,
    );
    // Fields the server keys on stay non-empty.
    expect(accepts(revenueCatWebhookBodySchema, body({ app_user_id: '' }))).toBe(false);
    expect(accepts(revenueCatWebhookBodySchema, body({ type: '' }))).toBe(false);
  });

  it('answers with one of three outcomes', () => {
    for (const status of ['accepted', 'duplicate', 'ignored']) {
      expect(accepts(revenueCatWebhookResponseSchema, { status })).toBe(true);
    }
    expect(accepts(revenueCatWebhookResponseSchema, { status: 'rejected' })).toBe(false);
  });
});

describe('billing jobs', () => {
  it('stay out of JOB_QUEUES until the worker defines them', () => {
    for (const queue of BILLING_JOB_QUEUES) {
      expect(JOB_QUEUES as readonly string[]).not.toContain(queue);
    }
    expect(Object.keys(BILLING_JOB_PAYLOAD_SCHEMAS).sort()).toEqual([...BILLING_JOB_QUEUES].sort());
  });

  it('carry identifiers only, strictly', () => {
    const process = BILLING_JOB_PAYLOAD_SCHEMAS['webhook.revenuecat.process'];
    const reconcile = BILLING_JOB_PAYLOAD_SCHEMAS['subscription.reconcile'];
    const job = { webhookEventId: uuidv7(), idempotencyKey: `revenuecat:${uuidv4()}` };
    expect(accepts(process, job)).toBe(true);
    expect(accepts(process, { ...job, event: { type: 'RENEWAL' } })).toBe(false);
    expect(accepts(reconcile, { userId: null, idempotencyKey: 'reconcile:2026-10-02' })).toBe(true);
    expect(accepts(reconcile, { userId: uuidv7(), idempotencyKey: 'reconcile:x:1' })).toBe(true);
    expect(accepts(reconcile, { idempotencyKey: 'reconcile:2026-10-02' })).toBe(false);
    for (const queue of BILLING_JOB_QUEUES) {
      const schema = z.toJSONSchema(BILLING_JOB_PAYLOAD_SCHEMAS[queue], { io: 'input' });
      expect(JSON.stringify(schema), queue).not.toContain('"additionalProperties":{}');
    }
  });
});

describe('deep links', () => {
  const targets: DeepLinkTarget[] = [
    { kind: 'teamInvite', code: base64url(LIMITS.inviteCode.length) },
    { kind: 'venue', slug: 'ornek-hali-saha' },
    { kind: 'openCalls', provinceSlug: 'istanbul', districtSlug: 'kadikoy' },
    { kind: 'verifyEmail', token: base64url(43) },
    { kind: 'resetPassword', token: base64url(64) },
  ];

  it('uses the Turkish web paths for the app scheme and https links', () => {
    expect(APP_SCHEME).toBe('kadro');
    const code = base64url(LIMITS.inviteCode.length);
    expect(appDeepLink({ kind: 'teamInvite', code })).toBe(`kadro://mac/${code}`);
    expect(webDeepLink('https://kadro.app', { kind: 'venue', slug: 'x-saha' })).toBe(
      'https://kadro.app/saha/x-saha',
    );
    expect(
      deepLinkPath({ kind: 'openCalls', provinceSlug: 'izmir', districtSlug: 'bornova' }),
    ).toBe('/eksik-var/izmir/bornova');
    expect(APP_LINK_PATH_PATTERNS).toEqual([
      '/mac/*',
      '/saha/*',
      '/eksik-var/*',
      '/e-posta-dogrula',
      '/sifre-sifirla',
    ]);
  });

  it('round-trips every target through the scheme, https and path forms', () => {
    for (const target of targets) {
      expect(parseDeepLink(appDeepLink(target)), target.kind).toEqual(target);
      expect(
        parseDeepLink(webDeepLink('https://kadro.app', target), ['https://kadro.app']),
        target.kind,
      ).toEqual(target);
      expect(parseDeepLink(deepLinkPath(target)), target.kind).toEqual(target);
    }
  });

  it('keeps email tokens in the fragment', () => {
    const token = base64url(43);
    expect(deepLinkPath({ kind: 'verifyEmail', token })).toBe(`/e-posta-dogrula#token=${token}`);
    expect(parseDeepLink(`/e-posta-dogrula?token=${token}`)).toBeNull();
    expect(parseDeepLink(`/e-posta-dogrula#lang=tr&token=${token}`)).toEqual({
      kind: 'verifyEmail',
      token,
    });
  });

  it('rejects a repeated or empty token key, like the web email-link pages', () => {
    const token = base64url(43);
    expect(parseDeepLink(`/sifre-sifirla#token=${token}&token=${token}`)).toBeNull();
    expect(parseDeepLink(`/sifre-sifirla#token=${token}&token=${base64url(43)}`)).toBeNull();
    expect(parseDeepLink(`/sifre-sifirla#token&token=${token}`)).toBeNull();
    expect(parseDeepLink('/sifre-sifirla#token=')).toBeNull();
  });

  it('rejects foreign origins, the old match name and malformed values', () => {
    const code = base64url(LIMITS.inviteCode.length);
    for (const link of [
      `https://evil.example/mac/${code}`,
      `https://kadro.app.evil.example/mac/${code}`,
      `kadro://match/${code}`,
      'kadro://mac/short',
      `kadro://mac/${code}/extra`,
      'kadro://saha/Not_A_Slug',
      'kadro://eksik-var/istanbul',
      'kadro://e-posta-dogrula',
      'kadro://sifre-sifirla#token=short',
      'javascript:alert(1)',
      '',
    ]) {
      expect(parseDeepLink(link, ['https://kadro.app']), link).toBeNull();
    }
    expect(parseDeepLink(`https://kadro.app/mac/${code}`)).toBeNull();
  });
});

describe('mobile client contract', () => {
  it('refreshes only on unauthenticated and signs out on deactivation', () => {
    expect(mobileProblemAction('unauthenticated')).toBe('refresh');
    expect(mobileProblemAction('account_deactivated')).toBe('signOut');
    for (const code of [
      'step_up_required',
      'totp_invalid',
      'token_invalid',
      'forbidden',
    ] as const) {
      expect(mobileProblemAction(code), code).toBe('show');
    }
  });

  it('recognizes problem codes', () => {
    expect(ERROR_CODES.every(isErrorCode)).toBe(true);
    expect(isErrorCode('nope')).toBe(false);
    expect(isErrorCode(401)).toBe(false);
  });
});

describe('admin schemas', () => {
  it('masks emails in the documented form', () => {
    expect(maskEmail('ayse@kadro.app')).toBe('a***@k***');
    expect(maskedEmailSchema.safeParse(maskEmail('ayse@kadro.app')).success).toBe(true);
    expect(maskedEmailSchema.safeParse('ayse@kadro.app').success).toBe(false);
  });

  it('enrolls TOTP only with one re-authentication proof', () => {
    expect(accepts(adminTotpEnrollRequestSchema, { password: 'correct horse' })).toBe(true);
    expect(
      accepts(adminTotpEnrollRequestSchema, {
        provider: 'apple',
        identityToken: jws(),
        nonce: base64url(32),
      }),
    ).toBe(true);
    expect(accepts(adminTotpEnrollRequestSchema, { provider: 'apple', identityToken: jws() })).toBe(
      false,
    );
    expect(accepts(adminTotpEnrollRequestSchema, {})).toBe(false);
    expect(
      accepts(adminTotpEnrollRequestSchema, { password: 'correct horse', totpCode: '123456' }),
    ).toBe(false);
  });

  it('returns a base32 secret with fixed parameters', () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    const response = {
      secret,
      otpauthUri: `otpauth://totp/Kadro:staff?secret=${secret}&issuer=Kadro`,
      algorithm: 'SHA1',
      digits: 6,
      periodSeconds: 30,
      confirmBy: isoAt(600_000),
    };
    expect(accepts(adminTotpEnrollResponseSchema, response)).toBe(true);
    expect(accepts(adminTotpEnrollResponseSchema, { ...response, secret: 'jbswy3dp' })).toBe(false);
    expect(accepts(adminTotpEnrollResponseSchema, { ...response, digits: 8 })).toBe(false);
  });

  it('needs a fresh code for role changes and accepts only platform roles', () => {
    expect(accepts(setUserRoleRequestSchema, { role: 'moderator', totpCode: '123456' })).toBe(true);
    expect(accepts(setUserRoleRequestSchema, { role: 'moderator' })).toBe(false);
    expect(accepts(setUserRoleRequestSchema, { role: 'captain', totpCode: '123456' })).toBe(false);
  });

  it('validates venue corrections and the import body', () => {
    expect(accepts(updateAdminVenueRequestSchema, { verified: true })).toBe(true);
    expect(accepts(updateAdminVenueRequestSchema, { phone: null, address: null })).toBe(true);
    expect(accepts(updateAdminVenueRequestSchema, {})).toBe(false);
    expect(accepts(updateAdminVenueRequestSchema, { slug: 'x' })).toBe(false);
    expect(accepts(updateAdminVenueRequestSchema, { priceMinMinor: 500, priceMaxMinor: 100 })).toBe(
      false,
    );
    expect(venueImportRequestSchema.parse({ csv: 'name,il\n' }).dryRun).toBe(false);
    expect(
      accepts(venueImportRequestSchema, { csv: 'x'.repeat(LIMITS.venueImportCsv.maxChars + 1) }),
    ).toBe(false);
  });

  it('keeps audit metadata to short scalars', () => {
    const row = {
      id: uuidv7(),
      actor: null,
      action: 'venue.verified',
      targetType: 'venue',
      targetId: uuidv7(),
      metadata: { verified: true, reason: 'duplicate' },
      createdAt: isoAt(),
    };
    expect(accepts(auditLogEntrySchema, row)).toBe(true);
    expect(accepts(auditLogEntrySchema, { ...row, metadata: { nested: { a: 1 } } })).toBe(false);
    expect(accepts(auditLogEntrySchema, { ...row, action: 'Venue Verified' })).toBe(false);
    expect(accepts(auditLogEntrySchema, { ...row, ipHash: 'x' })).toBe(false);
  });
});
