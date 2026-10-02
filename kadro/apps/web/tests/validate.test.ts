import {
  idSchema,
  LIMITS,
  paginationQuerySchema,
  REFRESH_REQUEST_SCHEMAS,
  registerRequestSchema,
} from '@kadro/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { json, route } from '../lib/server/http';
import { isStrictObjectSchema, noParams, noQuery, queryToObject } from '../lib/server/validate';
import { call, expectProblem, MOBILE, WEB } from './support/http';
import { installTestRuntime } from './support/runtime';

beforeAll(async () => {
  await installTestRuntime();
});

/** A value that must never be reflected in an error response. */
const SENTINEL = 'reflected-sentinel-7c1d';

const register = route({
  path: '/api/v1/test/register',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: registerRequestSchema,
  handler: ({ body }) => json({ email: body.email, displayName: body.displayName }),
});

const show = route({
  path: '/api/v1/test/items/[id]',
  method: 'GET',
  auth: 'none',
  params: z.strictObject({ id: idSchema }),
  query: paginationQuerySchema,
  body: null,
  handler: ({ params, query }) => json({ id: params.id, limit: query.limit }),
});

const remove = route({
  path: '/api/v1/test/items/[id]',
  method: 'DELETE',
  auth: 'none',
  params: z.strictObject({ id: idSchema }),
  query: noQuery,
  body: null,
  handler: () => new Response(null, { status: 204 }),
});

const refresh = route({
  path: '/api/v1/test/refresh',
  method: 'POST',
  auth: 'none',
  params: noParams,
  query: noQuery,
  body: { byClient: REFRESH_REQUEST_SCHEMAS },
  handler: ({ body }) => json({ keys: Object.keys(body) }),
});

const ITEM_ID = '01920000-0000-7000-8000-000000000001';
const validRegistration = {
  email: '  Oyuncu@Example.TEST ',
  password: 'A'.repeat(12),
  displayName: 'Test Oyuncu',
};

function post(body: unknown, headers: Record<string, string> = {}) {
  return call(register, {
    method: 'POST',
    path: '/api/v1/test/register',
    headers: { ...MOBILE, ...headers },
    json: body,
  });
}

describe('body validation', () => {
  it('accepts a valid body and hands the parsed value to the handler', async () => {
    const response = await post(validRegistration);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      email: 'oyuncu@example.test',
      displayName: 'Test Oyuncu',
    });
  });

  it('rejects an unknown key without echoing the key or its value', async () => {
    const response = await post({
      ...validRegistration,
      [`role_${SENTINEL}`]: `admin_${SENTINEL}`,
    });
    const text = await response.clone().text();
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors).toEqual([{ path: 'body', issue: 'unrecognized_keys' }]);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('admin');
  });

  it('rejects a server-only field such as role', async () => {
    const body = await expectProblem(
      await post({ ...validRegistration, role: 'admin' }),
      400,
      'validation_failed',
    );
    expect(body.errors?.[0]?.issue).toBe('unrecognized_keys');
  });

  it('rejects wrong types with the field path and zod issue code only', async () => {
    for (const wrong of [12345, true, null, ['Test Oyuncu'], { name: 'x' }]) {
      const body = await expectProblem(
        await post({ ...validRegistration, displayName: wrong }),
        400,
        'validation_failed',
      );
      expect(body.errors?.[0]).toEqual({ path: 'body.displayName', issue: 'invalid_type' });
      expect(body.errors?.every((error) => error.path === 'body.displayName')).toBe(true);
    }
  });

  it('rejects oversized strings without echoing them', async () => {
    const long = `${SENTINEL}${'A'.repeat(LIMITS.displayName.max)}`;
    const response = await post({ ...validRegistration, displayName: long });
    const text = await response.clone().text();
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors).toEqual([{ path: 'body.displayName', issue: 'too_big' }]);
    expect(text).not.toContain(SENTINEL);
    expect(text).not.toContain('AAAA');
  });

  it('does not echo an invalid email address', async () => {
    const response = await post({ ...validRegistration, email: `${SENTINEL}-not-an-email` });
    const text = await response.clone().text();
    await expectProblem(response, 400, 'validation_failed');
    expect(text).not.toContain(SENTINEL);
  });

  it('masks client-chosen record keys in field paths', async () => {
    const withRecord = route({
      path: '/api/v1/test/record',
      method: 'POST',
      auth: 'none',
      params: noParams,
      query: noQuery,
      body: z.strictObject({ tags: z.record(z.string(), z.number()) }),
      handler: () => json({}),
    });
    const response = await call(withRecord, {
      method: 'POST',
      headers: MOBILE,
      json: { tags: { [`<${SENTINEL}>`]: 'x' } },
    });
    const text = await response.clone().text();
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors?.[0]?.path).toBe('body.tags.*');
    expect(text).not.toContain(SENTINEL);
  });

  it('rejects an empty body', async () => {
    const response = await call(register, { method: 'POST', headers: MOBILE });
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors?.[0]?.path).toBe('body');
  });

  it('rejects malformed JSON', async () => {
    const response = await call(register, {
      method: 'POST',
      headers: { ...MOBILE, 'content-type': 'application/json' },
      body: `{"email": "${SENTINEL}"`,
    });
    const text = await response.clone().text();
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors).toEqual([{ path: 'body', issue: 'invalid_json' }]);
    expect(text).not.toContain(SENTINEL);
  });

  it('rejects invalid UTF-8', async () => {
    const response = await call(register, {
      method: 'POST',
      headers: { ...MOBILE, 'content-type': 'application/json' },
      body: new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]),
    });
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors).toEqual([{ path: 'body', issue: 'invalid_encoding' }]);
  });

  it('answers 415 for a body that is not JSON', async () => {
    for (const type of [
      'text/plain',
      'application/x-www-form-urlencoded',
      'application/json; charset=latin1',
    ]) {
      const response = await call(register, {
        method: 'POST',
        headers: { ...MOBILE, 'content-type': type },
        body: JSON.stringify(validRegistration),
      });
      await expectProblem(response, 415, 'unsupported_media_type');
    }
  });

  it('accepts application/json with an explicit utf-8 charset', async () => {
    const response = await call(register, {
      method: 'POST',
      headers: { ...MOBILE, 'content-type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(validRegistration),
    });
    expect(response.status).toBe(200);
  });
});

describe('1 MiB JSON body limit', () => {
  const oversized = JSON.stringify({
    ...validRegistration,
    padding: 'A'.repeat(LIMITS.jsonBodyMaxBytes),
  });

  it('rejects an oversized body sent without Content-Length with 413', async () => {
    const response = await call(register, {
      method: 'POST',
      headers: { ...MOBILE, 'content-type': 'application/json' },
      body: oversized,
    });
    expect(response.headers.get('content-length')).toBeNull();
    await expectProblem(response, 413, 'payload_too_large');
  });

  it('rejects a declared Content-Length above the limit with 413 before reading the body', async () => {
    let reads = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads += 1;
          controller.enqueue(new TextEncoder().encode('{}'));
          controller.close();
        },
      },
      { highWaterMark: 0 },
    );
    const request = new Request('https://kadro.app/api/v1/test/register', {
      method: 'POST',
      headers: {
        ...MOBILE,
        'content-type': 'application/json',
        'content-length': String(LIMITS.jsonBodyMaxBytes + 1),
      },
      body,
      duplex: 'half',
    } as RequestInit & { duplex: 'half' });
    expect(request.headers.get('content-length')).toBe(String(LIMITS.jsonBodyMaxBytes + 1));
    const response = await register(request, { params: Promise.resolve({}) });
    await expectProblem(response, 413, 'payload_too_large');
    expect(reads).toBe(0);
  });

  it('accepts a body whose declared Content-Length is within the limit', async () => {
    const request = new Request('https://kadro.app/api/v1/test/register', {
      method: 'POST',
      headers: {
        ...MOBILE,
        'content-type': 'application/json',
        'content-length': String(JSON.stringify(validRegistration).length),
      },
      body: JSON.stringify(validRegistration),
    });
    const response = await register(request, { params: Promise.resolve({}) });
    expect(response.status).toBe(200);
  });

  it('rejects a streamed body above the limit with 413 even without Content-Length', async () => {
    const chunk = new TextEncoder().encode('A'.repeat(64 * 1024));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > LIMITS.jsonBodyMaxBytes + chunk.byteLength) {
          controller.close();
          return;
        }
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });
    const response = await call(register, {
      method: 'POST',
      headers: { ...MOBILE, 'content-type': 'application/json' },
      body: stream,
    });
    await expectProblem(response, 413, 'payload_too_large');
    expect(sent).toBeLessThanOrEqual(LIMITS.jsonBodyMaxBytes + 2 * chunk.byteLength);
  });

  it('rejects a malformed Content-Length header', async () => {
    const request = new Request('https://kadro.app/api/v1/test/register', {
      method: 'POST',
      headers: { ...MOBILE, 'content-type': 'application/json' },
      body: JSON.stringify(validRegistration),
    });
    const forged = new Request(request, {
      headers: { ...MOBILE, 'content-type': 'application/json', 'content-length': '-1' },
    });
    const response = await register(forged, { params: Promise.resolve({}) });
    await expectProblem(response, 400, 'validation_failed');
  });
});

describe('query and params validation', () => {
  it('accepts valid params and query', async () => {
    const response = await call(show, {
      path: `/api/v1/test/items/${ITEM_ID}?limit=5`,
      headers: MOBILE,
      params: { id: ITEM_ID },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: ITEM_ID, limit: 5 });
  });

  it('rejects an unknown query parameter', async () => {
    const response = await call(show, {
      path: `/api/v1/test/items/${ITEM_ID}?debug=${SENTINEL}`,
      headers: MOBILE,
      params: { id: ITEM_ID },
    });
    const text = await response.clone().text();
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors).toEqual([{ path: 'query', issue: 'unrecognized_keys' }]);
    expect(text).not.toContain(SENTINEL);
  });

  it('rejects a repeated scalar query parameter', async () => {
    const response = await call(show, {
      path: `/api/v1/test/items/${ITEM_ID}?limit=1&limit=2`,
      headers: MOBILE,
      params: { id: ITEM_ID },
    });
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors?.[0]?.path).toBe('query.limit');
  });

  it('rejects out-of-range query values', async () => {
    for (const limit of ['0', '101', '-1', '1e2', 'abc']) {
      const response = await call(show, {
        path: `/api/v1/test/items/${ITEM_ID}?limit=${limit}`,
        headers: MOBILE,
        params: { id: ITEM_ID },
      });
      await expectProblem(response, 400, 'validation_failed');
    }
  });

  it('answers 400, not 404 or 500, for a malformed id', async () => {
    for (const id of ['1', 'not-a-uuid', '0b0e0c1a-4d6e-4b1f-9a8d-1c2b3a4d5e6f', `${SENTINEL}`]) {
      const response = await call(show, { headers: MOBILE, params: { id } });
      const text = await response.clone().text();
      const body = await expectProblem(response, 400, 'validation_failed');
      expect(body.errors?.[0]?.path).toBe('params.id');
      expect(text).not.toContain(SENTINEL);
    }
  });

  it('rejects a body on an operation that accepts none', async () => {
    const response = await call(remove, {
      method: 'DELETE',
      headers: MOBILE,
      params: { id: ITEM_ID },
      json: { cascade: true },
    });
    const body = await expectProblem(response, 400, 'validation_failed');
    expect(body.errors).toEqual([{ path: 'body', issue: 'unexpected_body' }]);
  });

  it('turns repeated keys into arrays and single keys into strings', () => {
    expect(queryToObject(new URLSearchParams('a=1&b=2&b=3'))).toEqual({ a: '1', b: ['2', '3'] });
  });
});

describe('client-specific body schemas (ADR-0014)', () => {
  it('selects the schema by x-kadro-client', async () => {
    const mobile = await call(refresh, {
      method: 'POST',
      headers: MOBILE,
      json: { refreshToken: 'A'.repeat(43) },
    });
    expect(await mobile.json()).toEqual({ keys: ['refreshToken'] });

    const web = await call(refresh, { method: 'POST', headers: WEB, json: {} });
    expect(await web.json()).toEqual({ keys: [] });

    const crossed = await call(refresh, {
      method: 'POST',
      headers: WEB,
      json: { refreshToken: 'A'.repeat(43) },
    });
    await expectProblem(crossed, 400, 'validation_failed');
  });
});

describe('route() construction guards', () => {
  const base = {
    path: '/api/v1/test/guard',
    auth: 'none',
    params: noParams,
    query: noQuery,
    handler: () => json({}),
  } as const;

  it('requires strict object schemas', () => {
    expect(() => route({ ...base, method: 'GET', query: z.object({}), body: null })).toThrow(
      TypeError,
    );
    expect(() =>
      route({ ...base, method: 'POST', body: z.object({ a: z.string() }).loose() }),
    ).toThrow(TypeError);
    expect(() => route({ ...base, method: 'POST', body: z.string() })).toThrow(TypeError);
  });

  it('requires a body schema on POST, PUT and PATCH and forbids one on GET', () => {
    for (const method of ['POST', 'PUT', 'PATCH'] as const) {
      expect(() => route({ ...base, method, body: null })).toThrow(TypeError);
    }
    expect(() => route({ ...base, method: 'GET', body: z.strictObject({}) })).toThrow(TypeError);
  });

  it('recognizes strict and refined strict objects', () => {
    expect(isStrictObjectSchema(z.strictObject({}))).toBe(true);
    expect(isStrictObjectSchema(z.object({}).strict())).toBe(true);
    expect(isStrictObjectSchema(z.strictObject({ a: z.string() }).refine(() => true))).toBe(true);
    expect(isStrictObjectSchema(z.object({}))).toBe(false);
    expect(isStrictObjectSchema(z.strictObject({}).transform(() => 1))).toBe(false);
  });
});
