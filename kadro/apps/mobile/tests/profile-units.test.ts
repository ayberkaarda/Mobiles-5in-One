import { createHash } from 'node:crypto';

import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';

import { LIMITS } from '../../../packages/contracts/src/limits';
import { UPLOAD_CONTENT_TYPES } from '../../../packages/contracts/src/uploads';
import {
  deleteAccountRequestSchema,
  LEVELS,
  type MeResponse,
  POSITIONS,
  registerPushTokenRequestSchema,
  updateMeRequestSchema,
} from '../../../packages/contracts/src/users';
import { ApiError } from '../src/api/errors';
import { createRawNonce, type RandomBytes } from '../src/auth/nonce';
import { createI18n } from '../src/i18n/create-i18n';
import {
  AVATAR_CONTENT_TYPES,
  AVATAR_MAX_BYTES,
  type AvatarPicker,
  uploadAvatar,
} from '../src/profile/avatar-upload';
import { initialsOf } from '../src/profile/components';
import {
  changedProfileFields,
  PROFILE_LEVELS,
  PROFILE_POSITIONS,
  profileFieldOf,
  profileValues,
} from '../src/profile/form';
import { createProfileApi } from '../src/profile/profile-api';
import { profileKeys } from '../src/profile/queries';
import { shouldPersistQuery } from '../src/query/persistence';
import {
  appleProof,
  createDeletionNoticeStore,
  DELETION_GRACE_DAYS,
  isDeletionAlreadyPending,
  needsTotp,
  NO_DELETION_NOTICE,
  passwordProof,
  proofMethod,
  startDeletion,
  TOTP_LENGTH,
  totpIssue,
} from '../src/settings/deletion';
import { chooseLanguage, LANGUAGE_STORAGE_KEY, restoreLanguage } from '../src/settings/language';
import { legalLink, legalLinks } from '../src/settings/legal';
import {
  EXPO_TOKEN_MAX,
  isExpoPushToken,
  type PushPermission,
  type PushPort,
  registerDevice,
} from '../src/settings/push';
import { createTestApi, issueTokens, problem, rotatingRefreshServer } from './support/api';
import { apiUrl, mswServer } from './support/msw';

// `initialsOf` lives next to the photo component, which loads `expo-image`.
vi.mock('expo-image', () => import('./support/expo-image'));

const ME_ID = '0192a0b0-0000-7000-8000-0000000000f1';
const KADIKOY_ID = '0192a0b0-0000-7000-8000-0000000000d1';
const UPLOAD_ID = '0192a0b0-0000-7000-8000-0000000000a9';
const STORAGE_URL = 'https://incoming.storage.test.invalid/avatar/object?signature=abc';

function me(overrides: Partial<MeResponse> = {}): MeResponse {
  return {
    id: ME_ID,
    displayName: 'Ali Kaleci',
    avatarUrl: null,
    position: 'GK',
    level: 'regular',
    email: 'ali@example.com',
    emailVerified: true,
    role: 'user',
    districtId: KADIKOY_ID,
    providers: { password: true, apple: false, google: false },
    createdAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('profile form', () => {
  it('offers exactly the contract positions and levels', () => {
    expect([...PROFILE_POSITIONS]).toEqual([...POSITIONS]);
    expect([...PROFILE_LEVELS]).toEqual([...LEVELS]);
  });

  it('sends only the changed fields, trimmed, and nothing when nothing changed', () => {
    const profile = me();
    expect(changedProfileFields(profile, profileValues(profile))).toBeNull();
    expect(
      changedProfileFields(profile, { ...profileValues(profile), displayName: '  Ali Kaleci ' }),
    ).toBeNull();
    const body = changedProfileFields(profile, {
      displayName: ' Ali Kale ',
      position: null,
      level: 'competitive',
      districtId: null,
    });
    expect(body).toEqual({
      displayName: 'Ali Kale',
      position: null,
      level: 'competitive',
      districtId: null,
    });
    expect(updateMeRequestSchema.safeParse(body).success).toBe(true);
  });

  it('builds bodies the contract accepts for every single-field change', () => {
    const profile = me({ position: null, level: null, districtId: null });
    for (const position of POSITIONS) {
      const body = changedProfileFields(profile, { ...profileValues(profile), position });
      expect(updateMeRequestSchema.safeParse(body).success).toBe(true);
    }
    for (const level of LEVELS) {
      const body = changedProfileFields(profile, { ...profileValues(profile), level });
      expect(updateMeRequestSchema.safeParse(body).success).toBe(true);
    }
    const body = changedProfileFields(profile, {
      ...profileValues(profile),
      districtId: KADIKOY_ID,
    });
    expect(body).toEqual({ districtId: KADIKOY_ID });
    expect(updateMeRequestSchema.safeParse(body).success).toBe(true);
  });

  it('maps server field paths to form fields', () => {
    expect(profileFieldOf('body.displayName')).toBe('displayName');
    expect(profileFieldOf('body.districtId')).toBe('districtId');
    expect(profileFieldOf('body')).toBeNull();
    expect(profileFieldOf('body.role')).toBeNull();
    expect(profileFieldOf('displayName')).toBeNull();
    expect(profileFieldOf('query.displayName')).toBeNull();
  });

  it('makes initials from the first two words', () => {
    expect(initialsOf('ali kaleci')).toBe('AK');
    expect(initialsOf('  İlkay  Şen  Demir ')).toBe('İŞ');
    expect(initialsOf('Ege')).toBe('E');
  });
});

describe('profile cache', () => {
  it('keeps the statistics under the memory-only me root', () => {
    expect(profileKeys.stats()[0]).toBe('me');
    expect(
      shouldPersistQuery({
        queryKey: profileKeys.stats(),
        state: { status: 'success', data: { tier: 'basic', matchesPlayed: 1, mvpCount: 0 } },
      } as unknown as Parameters<typeof shouldPersistQuery>[0]),
    ).toBe(false);
  });
});

function picker(blob: Blob, mimeType: string | null = null): AvatarPicker & { picks: number } {
  const state = {
    picks: 0,
    async pick() {
      state.picks += 1;
      return { uri: 'file:///photo.jpg', mimeType };
    },
    async read() {
      return blob;
    },
  };
  return state;
}

describe('avatar upload', () => {
  const { api } = createTestApi();
  const profile = createProfileApi(api);

  it('mirrors the contract limits and types', () => {
    expect(AVATAR_MAX_BYTES).toBe(LIMITS.uploadBytes.max);
    expect([...AVATAR_CONTENT_TYPES]).toEqual([...UPLOAD_CONTENT_TYPES]);
  });

  it('presigns the exact size, PUTs with the signed headers, completes and waits for ready', async () => {
    const testApi = createTestApi();
    await testApi.session.establish(issueTokens());
    const calls: string[] = [];
    let presignBody: unknown = null;
    let putHeaders: Record<string, string> = {};
    let putBytes = 0;
    let reads = 0;
    mswServer.use(
      http.post(apiUrl('/api/v1/uploads/presign'), async ({ request }) => {
        calls.push('presign');
        presignBody = await request.json();
        return HttpResponse.json(
          {
            uploadId: UPLOAD_ID,
            url: STORAGE_URL,
            method: 'PUT',
            headers: { 'Content-Type': 'image/png', 'Content-Length': '5' },
            expiresAt: '2026-10-03T10:05:00.000Z',
          },
          { status: 201 },
        );
      }),
      http.put(STORAGE_URL, async ({ request }) => {
        calls.push('put');
        putHeaders = Object.fromEntries(request.headers.entries());
        putBytes = (await request.arrayBuffer()).byteLength;
        return new HttpResponse(null, { status: 200 });
      }),
      http.post(apiUrl(`/api/v1/uploads/${UPLOAD_ID}/complete`), () => {
        calls.push('complete');
        return HttpResponse.json({ status: 'processing' }, { status: 202 });
      }),
      http.get(apiUrl(`/api/v1/uploads/${UPLOAD_ID}`), () => {
        reads += 1;
        calls.push('status');
        return HttpResponse.json({
          id: UPLOAD_ID,
          kind: 'avatar',
          status: reads < 2 ? 'processing' : 'ready',
          rejectReason: null,
          url: reads < 2 ? null : 'https://cdn.test.invalid/avatars/a.webp',
        });
      }),
    );
    const outcome = await uploadAvatar({
      picker: picker(new Blob([new Uint8Array(5)], { type: 'image/png' })),
      profile: createProfileApi(testApi.api),
      sleep: async () => undefined,
    });
    expect(outcome).toEqual({ kind: 'ready', url: 'https://cdn.test.invalid/avatars/a.webp' });
    expect(calls).toEqual(['presign', 'put', 'complete', 'status', 'status']);
    // No storage key, no user id: kind, type and the exact length only.
    expect(presignBody).toEqual({ kind: 'avatar', contentType: 'image/png', contentLength: 5 });
    expect(putHeaders['content-type']).toBe('image/png');
    // The bearer token never goes to object storage.
    expect(putHeaders.authorization).toBeUndefined();
    expect(putBytes).toBe(5);
  });

  it('refuses a wrong type or size on the device without any request', async () => {
    // No handler is registered: any request would fail the test.
    const tooBig = await uploadAvatar({
      picker: picker(new Blob([new Uint8Array(AVATAR_MAX_BYTES + 1)], { type: 'image/jpeg' })),
      profile,
    });
    expect(tooBig).toEqual({ kind: 'invalid', reason: 'size' });
    const empty = await uploadAvatar({
      picker: picker(new Blob([], { type: 'image/jpeg' })),
      profile,
    });
    expect(empty).toEqual({ kind: 'invalid', reason: 'size' });
    const gif = await uploadAvatar({
      picker: picker(new Blob([new Uint8Array(3)], { type: 'image/gif' })),
      profile,
    });
    expect(gif).toEqual({ kind: 'invalid', reason: 'type' });
    // The picker's MIME type is used when the file itself carries none.
    const fromPicker = await uploadAvatar({
      picker: picker(new Blob([new Uint8Array(AVATAR_MAX_BYTES + 1)]), 'image/webp'),
      profile,
    });
    expect(fromPicker).toEqual({ kind: 'invalid', reason: 'size' });
    const cancelled = await uploadAvatar({
      picker: { pick: async () => null, read: async () => new Blob() },
      profile,
    });
    expect(cancelled).toEqual({ kind: 'cancelled' });
  });

  it('reports a storage failure as an error and never completes', async () => {
    const testApi = createTestApi();
    await testApi.session.establish(issueTokens());
    let completed = false;
    mswServer.use(
      http.post(apiUrl('/api/v1/uploads/presign'), () =>
        HttpResponse.json(
          {
            uploadId: UPLOAD_ID,
            url: STORAGE_URL,
            method: 'PUT',
            headers: { 'Content-Type': 'image/jpeg', 'Content-Length': '3' },
            expiresAt: '2026-10-03T10:05:00.000Z',
          },
          { status: 201 },
        ),
      ),
      http.put(STORAGE_URL, () => new HttpResponse(null, { status: 403 })),
      http.post(apiUrl(`/api/v1/uploads/${UPLOAD_ID}/complete`), () => {
        completed = true;
        return HttpResponse.json({ status: 'processing' }, { status: 202 });
      }),
    );
    await expect(
      uploadAvatar({
        picker: picker(new Blob([new Uint8Array(3)], { type: 'image/jpeg' })),
        profile: createProfileApi(testApi.api),
      }),
    ).rejects.toMatchObject({ kind: 'problem', status: 403 });
    expect(completed).toBe(false);
  });

  it('ends with rejected or still processing after the last status read', async () => {
    const fake = {
      presignAvatar: async () => ({
        uploadId: UPLOAD_ID,
        url: STORAGE_URL,
        method: 'PUT' as const,
        headers: { 'Content-Type': 'image/jpeg' as const, 'Content-Length': '3' },
        expiresAt: '2026-10-03T10:05:00.000Z',
      }),
      completeUpload: async () => undefined,
    };
    const ok = (async () => new Response(null, { status: 200 })) as typeof fetch;
    const rejected = await uploadAvatar({
      picker: picker(new Blob([new Uint8Array(3)], { type: 'image/jpeg' })),
      profile: {
        ...fake,
        uploadStatus: async () => ({
          id: UPLOAD_ID,
          kind: 'avatar',
          status: 'rejected',
          rejectReason: 'not_an_image',
          url: null,
        }),
      },
      fetchImpl: ok,
      sleep: async () => undefined,
    });
    expect(rejected).toEqual({ kind: 'rejected', reason: 'not_an_image' });
    let reads = 0;
    const processing = await uploadAvatar({
      picker: picker(new Blob([new Uint8Array(3)], { type: 'image/jpeg' })),
      profile: {
        ...fake,
        uploadStatus: async () => {
          reads += 1;
          return {
            id: UPLOAD_ID,
            kind: 'avatar',
            status: 'processing',
            rejectReason: null,
            url: null,
          };
        },
      },
      fetchImpl: ok,
      sleep: async () => undefined,
      pollDelaysMs: [1, 1, 1],
    });
    expect(processing).toEqual({ kind: 'processing' });
    expect(reads).toBe(3);
  });
});

function fakePush(options: {
  platform?: 'ios' | 'android' | null;
  permission?: PushPermission;
  token?: string | Error;
}): PushPort & { requests: number } {
  const port = {
    requests: 0,
    platform: options.platform === undefined ? ('ios' as const) : options.platform,
    permission: async () => options.permission ?? 'undetermined',
    requestPermission: async () => {
      port.requests += 1;
      return options.permission ?? 'granted';
    },
    expoToken: async () => {
      if (options.token instanceof Error) {
        throw options.token;
      }
      return options.token ?? 'ExponentPushToken[abc-DEF_123]';
    },
  };
  return port;
}

describe('push registration', () => {
  it('validates tokens like the contract', () => {
    const samples = [
      'ExponentPushToken[abc-DEF_123]',
      'ExpoPushToken[x]',
      'ExpoPushToken[]',
      'ExponentPushToken[a b]',
      'FcmToken[abc]',
      `ExpoPushToken[${'a'.repeat(200)}]`,
      `ExpoPushToken[${'a'.repeat(201)}]`,
    ];
    expect(EXPO_TOKEN_MAX).toBe(LIMITS.expoPushToken.max);
    for (const token of samples) {
      expect(isExpoPushToken(token)).toBe(
        registerPushTokenRequestSchema.safeParse({ expoToken: token, platform: 'ios' }).success,
      );
    }
  });

  it('registers the token with the platform, the owner is the session', async () => {
    const bodies: unknown[] = [];
    const outcome = await registerDevice(fakePush({ platform: 'android' }), {
      registerPushToken: async (body) => {
        bodies.push(body);
      },
    });
    expect(outcome).toBe('registered');
    expect(bodies).toEqual([{ expoToken: 'ExponentPushToken[abc-DEF_123]', platform: 'android' }]);
    expect(registerPushTokenRequestSchema.safeParse(bodies[0]).success).toBe(true);
  });

  it('sends nothing when push is unavailable, refused, undecided or the token is bad', async () => {
    const bodies: unknown[] = [];
    const profile = {
      registerPushToken: async (body: unknown) => {
        bodies.push(body);
      },
    };
    const unavailable = fakePush({ platform: null });
    expect(await registerDevice(unavailable, profile)).toBe('unavailable');
    expect(unavailable.requests).toBe(0);
    expect(await registerDevice(fakePush({ permission: 'denied' }), profile)).toBe('denied');
    expect(await registerDevice(fakePush({ permission: 'undetermined' }), profile)).toBeNull();
    expect(await registerDevice(fakePush({ token: new Error('no fcm') }), profile)).toBe('failed');
    expect(await registerDevice(fakePush({ token: 'not-a-token' }), profile)).toBe('failed');
    expect(bodies).toEqual([]);
  });
});

describe('language preference', () => {
  function memoryStorage(initial: Record<string, string> = {}) {
    const values = new Map(Object.entries(initial));
    return {
      values,
      getItem: async (key: string) => values.get(key) ?? null,
      setItem: async (key: string, value: string) => {
        values.set(key, value);
      },
    };
  }

  it('switches at once and remembers the choice', async () => {
    const i18n = createI18n({ tr: {}, en: {} } as never, 'tr');
    const storage = memoryStorage();
    await chooseLanguage(i18n, 'en', storage);
    expect(i18n.language).toBe('en');
    expect(storage.values.get(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('restores a remembered language and ignores unknown or unreadable values', async () => {
    const i18n = createI18n({ tr: {}, en: {} } as never, 'tr');
    await restoreLanguage(i18n, memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'de' }));
    expect(i18n.language).toBe('tr');
    await restoreLanguage(i18n, {
      getItem: async () => {
        throw new Error('storage unavailable');
      },
      setItem: async () => undefined,
    });
    expect(i18n.language).toBe('tr');
    await restoreLanguage(i18n, memoryStorage({ [LANGUAGE_STORAGE_KEY]: 'en' }));
    expect(i18n.language).toBe('en');
  });

  it('keeps the switch when the preference cannot be saved', async () => {
    const i18n = createI18n({ tr: {}, en: {} } as never, 'tr');
    await chooseLanguage(i18n, 'en', {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('full');
      },
    });
    expect(i18n.language).toBe('en');
  });
});

describe('legal links', () => {
  it('are built only from an https web origin', () => {
    expect(legalLinks(undefined)).toEqual([]);
    expect(legalLinks('')).toEqual([]);
    expect(legalLinks('http://kadro.app')).toEqual([]);
    expect(legalLinks('not a url')).toEqual([]);
    const links = legalLinks('https://kadro.app');
    expect(links.map((link) => link.url)).toEqual([
      'https://kadro.app/gizlilik',
      'https://kadro.app/kvkk-aydinlatma',
      'https://kadro.app/hesap-silme',
    ]);
    expect(legalLink(links, 'deletion')).toBe('https://kadro.app/hesap-silme');
    expect(legalLink([], 'deletion')).toBeNull();
  });
});

const fixedBytes: RandomBytes = (length) => new Uint8Array(length).fill(7);

describe('account deletion', () => {
  it('mirrors the contract limits', () => {
    expect(TOTP_LENGTH).toBe(LIMITS.totpCode.length);
    expect(DELETION_GRACE_DAYS * 24 * 60 * 60).toBe(LIMITS.accountDeletionGraceSeconds);
  });

  it('picks the proof the account can give', () => {
    const password = { providers: { password: true, apple: true, google: true } };
    const apple = { providers: { password: false, apple: true, google: false } };
    const google = { providers: { password: false, apple: false, google: true } };
    expect(proofMethod(password, false)).toBe('password');
    expect(proofMethod(apple, true)).toBe('apple');
    expect(proofMethod(apple, false)).toBe('web');
    expect(proofMethod(google, true)).toBe('web');
    expect(needsTotp({ role: 'user' })).toBe(false);
    expect(needsTotp({ role: 'moderator' })).toBe(true);
    expect(needsTotp({ role: 'admin' })).toBe(true);
  });

  it('builds password and TOTP bodies the contract accepts', () => {
    expect(deleteAccountRequestSchema.safeParse(passwordProof('secret', null)).success).toBe(true);
    expect(deleteAccountRequestSchema.safeParse(passwordProof('secret', '123456')).success).toBe(
      true,
    );
    for (const code of ['123456', '12345', '1234567', '12a456', '', ' 123456']) {
      expect(totpIssue(code) === null).toBe(
        deleteAccountRequestSchema.safeParse({ password: 'x', totpCode: code }).success,
      );
    }
  });

  it('sends Apple the hashed nonce and the server the raw one', async () => {
    const authorized: string[] = [];
    const proof = await appleProof(
      {
        isAvailable: async () => true,
        authorize: async (hashedNonce) => {
          authorized.push(hashedNonce);
          return { identityToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln', fullName: null };
        },
      },
      fixedBytes,
      null,
    );
    const raw = createRawNonce(fixedBytes) ?? '';
    expect(proof).toEqual({
      kind: 'proof',
      body: {
        provider: 'apple',
        identityToken: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln',
        nonce: raw,
      },
    });
    expect(authorized).toEqual([createHash('sha256').update(raw).digest('hex')]);
    if (proof.kind === 'proof') {
      expect(deleteAccountRequestSchema.safeParse(proof.body).success).toBe(true);
    }
  });

  it('reports a cancelled or impossible Apple proof without a body', async () => {
    const cancelled = await appleProof(
      { isAvailable: async () => true, authorize: async () => null },
      fixedBytes,
      null,
    );
    expect(cancelled).toEqual({ kind: 'cancelled' });
    const noRandom = await appleProof(
      { isAvailable: async () => true, authorize: async () => null },
      () => null,
      null,
    );
    expect(noRandom).toEqual({ kind: 'unavailable' });
  });

  it('shows the notice before the session ends and signs out without a logout call', async () => {
    const order: string[] = [];
    const notice = createDeletionNoticeStore();
    const graceUntil = await startDeletion(
      {
        profile: {
          deleteAccount: async () => {
            order.push('delete');
            return { graceUntil: '2026-10-10T10:00:00.000Z' };
          },
        },
        session: {
          signOut: async (options) => {
            order.push(`signOut:${String(options.revokeRemote)}`);
          },
        },
        notice,
        showNotice: () => {
          order.push(`notice:${String(notice.getState().graceUntil)}`);
        },
      },
      { password: 'secret' },
    );
    expect(graceUntil).toBe('2026-10-10T10:00:00.000Z');
    expect(order).toEqual(['delete', 'notice:2026-10-10T10:00:00.000Z', 'signOut:false']);
  });

  it('changes nothing locally when the request fails', async () => {
    const notice = createDeletionNoticeStore();
    let signedOut = false;
    await expect(
      startDeletion(
        {
          profile: {
            deleteAccount: async () => {
              throw new ApiError({ kind: 'problem', status: 401, code: 'reauth_required' });
            },
          },
          session: {
            signOut: async () => {
              signedOut = true;
            },
          },
          notice,
          showNotice: () => undefined,
        },
        { password: 'wrong' },
      ),
    ).rejects.toMatchObject({ code: 'reauth_required' });
    expect(signedOut).toBe(false);
    expect(notice.getState()).toEqual(NO_DELETION_NOTICE);
  });

  it('signs out even when opening the notice screen throws', async () => {
    const notice = createDeletionNoticeStore();
    let signedOut = false;
    await expect(
      startDeletion(
        {
          profile: { deleteAccount: async () => ({ graceUntil: '2026-10-10T10:00:00.000Z' }) },
          session: {
            signOut: async () => {
              signedOut = true;
            },
          },
          notice,
          showNotice: () => {
            throw new Error('navigation failed');
          },
        },
        { password: 'secret' },
      ),
    ).rejects.toThrow('navigation failed');
    expect(signedOut).toBe(true);
    expect(notice.getState()).toEqual({ pending: true, graceUntil: '2026-10-10T10:00:00.000Z' });
  });

  it('treats deletion_pending and account_deactivated as an already pending deletion', async () => {
    for (const refusal of [
      new ApiError({ kind: 'problem', status: 409, code: 'deletion_pending' }),
      new ApiError({ kind: 'problem', status: 401, code: 'account_deactivated' }),
    ]) {
      const notice = createDeletionNoticeStore();
      const order: string[] = [];
      const graceUntil = await startDeletion(
        {
          profile: {
            deleteAccount: async () => {
              throw refusal;
            },
          },
          session: {
            signOut: async () => {
              order.push('signOut');
            },
          },
          notice,
          showNotice: () => {
            order.push('notice');
          },
        },
        { password: 'secret' },
      );
      expect(graceUntil).toBeNull();
      expect(order).toEqual(['notice', 'signOut']);
      expect(notice.getState()).toEqual({ pending: true, graceUntil: null });
    }
    expect(
      isDeletionAlreadyPending(
        new ApiError({ kind: 'problem', status: 401, code: 'reauth_required' }),
      ),
    ).toBe(false);
    expect(isDeletionAlreadyPending(new ApiError({ kind: 'network' }))).toBe(false);
  });
});

describe('api client and proof refusals', () => {
  it('does not refresh and replay when the server refuses the proof itself', async () => {
    const { api, session } = createTestApi();
    const tokens = issueTokens();
    await session.establish(tokens);
    const refresh = rotatingRefreshServer(tokens.refreshToken);
    let deletes = 0;
    mswServer.use(
      http.delete(apiUrl('/api/v1/me'), () => {
        deletes += 1;
        return problem(401, deletes === 1 ? 'reauth_required' : 'step_up_required');
      }),
    );
    await expect(
      api.request('/api/v1/me', { method: 'DELETE', body: { password: 'wrong' } }),
    ).rejects.toMatchObject({ status: 401, code: 'reauth_required' });
    await expect(
      api.request('/api/v1/me', { method: 'DELETE', body: { password: 'right' } }),
    ).rejects.toMatchObject({ status: 401, code: 'step_up_required' });
    expect(deletes).toBe(2);
    expect(refresh.calls()).toBe(0);
    expect(session.hasSession()).toBe(true);
  });

  it('still refreshes and replays once for a rejected access token', async () => {
    const { api, session } = createTestApi();
    const tokens = issueTokens();
    await session.establish(tokens);
    const refresh = rotatingRefreshServer(tokens.refreshToken);
    let deletes = 0;
    mswServer.use(
      http.delete(apiUrl('/api/v1/me'), () => {
        deletes += 1;
        return deletes === 1
          ? problem(401, 'unauthenticated')
          : HttpResponse.json({ graceUntil: '2026-10-10T10:00:00.000Z' }, { status: 202 });
      }),
    );
    await expect(
      api.request('/api/v1/me', { method: 'DELETE', body: { password: 'secret' } }),
    ).resolves.toEqual({ graceUntil: '2026-10-10T10:00:00.000Z' });
    expect(deletes).toBe(2);
    expect(refresh.calls()).toBe(1);
  });
});
