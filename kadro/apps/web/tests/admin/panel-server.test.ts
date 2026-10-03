import { adminUserSchema, type MeResponse, paginatedResponseSchema } from '@kadro/contracts';
import { describe, expect, it } from 'vitest';

import { forwardedHeaders, interpretAdminResponse, pickQuery } from '../../lib/admin/server-api';
import { viewerFrom } from '../../lib/admin/session';

/**
 * Server side of the staff panel (ADR-0068): which request headers reach the in-process API
 * call, how route answers become page decisions, and who counts as staff.
 */

const page = paginatedResponseSchema(adminUserSchema);
const ID = '0192a5e4-7b3c-7d2e-8f10-123456789abc';

describe('forwardedHeaders', () => {
  it('forwards only the cookies, the trusted client address and the request id', () => {
    const incoming = new Headers({
      cookie: '__Host-kadro_session=abc; __Host-kadro_csrf=def',
      'x-forwarded-for': '203.0.113.7, 10.0.0.5',
      'x-request-id': '4f0c2a8e-2a51-4c55-9a5c-0d6c2b1f9e11',
      authorization: 'Bearer something',
      origin: 'https://evil.example',
      'x-kadro-client': 'mobile',
      'x-csrf-token': 'def',
    });
    const forwarded = forwardedHeaders(incoming, 'X-Forwarded-For');
    expect(Object.fromEntries(forwarded.entries())).toEqual({
      accept: 'application/json',
      cookie: '__Host-kadro_session=abc; __Host-kadro_csrf=def',
      'x-forwarded-for': '203.0.113.7, 10.0.0.5',
      'x-kadro-client': 'web',
      'x-request-id': '4f0c2a8e-2a51-4c55-9a5c-0d6c2b1f9e11',
    });
  });

  it('works without cookies or proxy headers', () => {
    const forwarded = forwardedHeaders(new Headers(), 'x-forwarded-for');
    expect(forwarded.has('cookie')).toBe(false);
    expect(forwarded.get('x-kadro-client')).toBe('web');
  });
});

describe('interpretAdminResponse', () => {
  it('validates a 200 body against the contract schema', () => {
    const body = {
      items: [
        {
          id: ID,
          displayName: 'Ayşe',
          maskedEmail: 'a***@k***',
          role: 'user',
          emailVerified: true,
          deactivatedAt: null,
          totpEnrolled: false,
          createdAt: '2026-10-01T10:00:00.000Z',
        },
      ],
      nextCursor: null,
    };
    expect(interpretAdminResponse(200, body, page)).toEqual({ kind: 'ok', data: body });
    // A body outside the contract (here: an unmasked address) is never rendered.
    const leaked = { ...body, items: [{ ...body.items[0], maskedEmail: 'ayse@kadro.app' }] };
    expect(interpretAdminResponse(200, leaked, page)).toEqual({ kind: 'unavailable' });
  });

  it('maps problem answers to page decisions', () => {
    const cases: [number, unknown, string][] = [
      [401, { code: 'step_up_required' }, 'step_up'],
      [401, { code: 'unauthenticated' }, 'signed_out'],
      [401, { code: 'account_deactivated' }, 'signed_out'],
      [401, null, 'signed_out'],
      [403, { code: 'forbidden' }, 'forbidden'],
      [403, { code: 'csrf_failed' }, 'signed_out'],
      [404, { code: 'not_found' }, 'not_found'],
      [400, { code: 'invalid_cursor' }, 'invalid'],
      [429, { code: 'rate_limited' }, 'unavailable'],
      [500, { code: 'internal_error' }, 'unavailable'],
      [503, { code: 'made_up_code' }, 'unavailable'],
    ];
    for (const [status, body, kind] of cases) {
      expect(interpretAdminResponse(status, body, page).kind, `${status}`).toBe(kind);
    }
  });
});

describe('pickQuery', () => {
  it('keeps allowed keys with one non-empty string value', () => {
    expect(
      pickQuery(
        {
          q: 'Ali',
          role: ['admin', 'user'],
          cursor: '',
          verified: 'false',
          constructor: 'y',
        },
        ['q', 'role', 'cursor', 'constructor'],
      ),
    ).toEqual({ q: 'Ali', constructor: 'y' });
  });
});

describe('viewerFrom', () => {
  const me = (role: MeResponse['role']) =>
    ({ id: ID, displayName: 'Ayşe', role }) as unknown as MeResponse;

  it('treats moderators and admins as staff, everyone else as not staff', () => {
    expect(viewerFrom({ kind: 'ok', data: me('admin') })).toMatchObject({
      kind: 'staff',
      isAdmin: true,
    });
    expect(viewerFrom({ kind: 'ok', data: me('moderator') })).toMatchObject({
      kind: 'staff',
      isAdmin: false,
    });
    expect(viewerFrom({ kind: 'ok', data: me('user') })).toEqual({ kind: 'not_staff' });
    expect(viewerFrom({ kind: 'forbidden' })).toEqual({ kind: 'not_staff' });
    expect(viewerFrom({ kind: 'signed_out' })).toEqual({ kind: 'signed_out' });
    expect(viewerFrom({ kind: 'unavailable' })).toEqual({ kind: 'unavailable' });
  });
});
