import { makeStateKey, PendingTasks, PLATFORM_ID, TransferState } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { DEFAULT_PUBLIC_WEB_CONFIG, PUBLIC_WEB_CONFIG } from '../public-config';
import { API_INTERNAL_BASE_URL } from './api-internal-base-url';
import { apiPath, PublicApiClient, PublicApiResult } from './public-api.client';

interface Item {
  name: string;
}

function isItem(value: unknown): value is Item {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>)['name'] === 'string'
  );
}

function setup(platform: 'server' | 'browser' = 'browser', state = new TransferState()) {
  TestBed.resetTestingModule();
  const run = vi.fn((task: () => Promise<unknown>) => {
    void task();
  });
  TestBed.configureTestingModule({
    providers: [
      { provide: PLATFORM_ID, useValue: platform },
      { provide: TransferState, useValue: state },
      { provide: PendingTasks, useValue: { run } },
      { provide: PUBLIC_WEB_CONFIG, useValue: DEFAULT_PUBLIC_WEB_CONFIG },
      ...(platform === 'server'
        ? [{ provide: API_INTERNAL_BASE_URL, useValue: 'http://internal.example/v1' }]
        : []),
    ],
  });
  return { client: TestBed.inject(PublicApiClient), state, run };
}

afterEach(() => {
  vi.unstubAllGlobals();
  TestBed.resetTestingModule();
});

describe('public API client', () => {
  it('accepts guarded data and calls the public base without credentials', async () => {
    const fetchMock = vi.fn(async () => new Response('{"name":"İstanbul"}'));
    vi.stubGlobal('fetch', fetchMock);
    const { client } = setup();
    expect(await client.get('/lines', { z: 'a b', a: 2 }, isItem)).toEqual({
      ok: true,
      data: { name: 'İstanbul' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.inecekvar.app/v1/lines?a=2&z=a+b',
      expect.objectContaining({
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        headers: { accept: 'application/json, application/problem+json' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it.each([404, 410])('recognizes a status %s problem and copies its safe code', async (status) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'Missing',
              status,
              code: 'line.not_found',
              request_id: 'request-1',
            }),
            {
              status,
              headers: { 'content-type': 'application/problem+json; charset=utf-8' },
            },
          ),
      ),
    );
    const { client } = setup();
    expect(await client.get('/missing', undefined, isItem)).toEqual({
      ok: false,
      kind: 'not_found',
      status,
      code: 'line.not_found',
    });
  });

  it.each([
    { code: '<private>', type: 'application/problem+json', request_id: 'request-1' },
    { code: 'valid', type: 'application/json', request_id: 'request-1' },
    { code: 'valid', type: 'application/problem+json', request_id: undefined },
  ])('does not copy an untrusted problem code', async ({ code, type, request_id }) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              type: 'about:blank',
              title: 'Missing',
              status: 404,
              code,
              request_id,
            }),
            { status: 404, headers: { 'content-type': type } },
          ),
      ),
    );
    expect(await setup().client.get('/missing', undefined, isItem)).toEqual({
      ok: false,
      kind: 'not_found',
      status: 404,
      code: null,
    });
  });

  it('maps server errors to unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 500 })),
    );
    expect(await setup().client.get('/lines', undefined, isItem)).toEqual({
      ok: false,
      kind: 'unavailable',
      status: 500,
      code: null,
    });
  });

  it.each(['AbortError', 'TimeoutError'])('maps %s to unavailable', async (name) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('Request ended', name);
      }),
    );
    expect(await setup().client.get('/lines', undefined, isItem)).toEqual({
      ok: false,
      kind: 'unavailable',
      status: 0,
      code: null,
    });
  });

  it.each(['not json', '{"other":true}'])(
    'rejects an invalid successful response',
    async (text) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(text)),
      );
      expect(await setup().client.get('/lines', undefined, isItem)).toEqual({
        ok: false,
        kind: 'unavailable',
        status: 200,
        code: 'invalid_response',
      });
    },
  );

  it('rejects bodies over two MiB measured in UTF-8 bytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ü'.repeat(1024 * 1024 + 1))),
    );
    expect(await setup().client.get('/lines', undefined, isItem)).toEqual({
      ok: false,
      kind: 'unavailable',
      status: 200,
      code: null,
    });
  });

  it.each([200, 500])(
    'transfers status %s from the internal base and consumes it once',
    async (status) => {
      const fetchMock = vi.fn(async () => new Response('{"name":"Hat"}', { status }));
      vi.stubGlobal('fetch', fetchMock);
      const { client, state, run } = setup('server');
      const result = await client.get('/lines', { z: 3, a: 1 }, isItem);
      const key = makeStateKey<PublicApiResult<Item>>('iv-api:/lines?a=1&z=3');
      const fallback: PublicApiResult<Item> = {
        ok: false,
        kind: 'unavailable',
        status: 0,
        code: null,
      };
      expect(state.get(key, fallback)).toEqual(result);
      expect(run).toHaveBeenCalledOnce();
      expect(fetchMock).toHaveBeenCalledWith(
        'http://internal.example/v1/lines?a=1&z=3',
        expect.objectContaining({
          credentials: 'omit',
          redirect: 'error',
          headers: { accept: 'application/json, application/problem+json' },
        }),
      );
      fetchMock.mockClear();
      const browser = setup('browser', state).client;
      expect(await browser.get('/lines', { a: 1, z: 3 }, isItem)).toEqual(result);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(state.hasKey(key)).toBe(false);
      await browser.get('/lines', { a: 1, z: 3 }, isItem);
      expect(fetchMock).toHaveBeenCalledOnce();
    },
  );

  it('encodes each path parameter as one segment', () => {
    expect(apiPath('/lines/{slug}', { slug: '../a/b' })).toBe('/lines/%2E%2E%2Fa%2Fb');
    expect(apiPath('/lines/{slug}', { slug: 'İş !' })).toBe('/lines/%C4%B0%C5%9F%20%21');
    expect(() => apiPath('/lines/{slug}', {})).toThrow('Missing path parameter');
  });

  it.each(['//evil.example', 'https://evil.example', '/a/../b', '/a?x=1', '/a#x', '/a\\b'])(
    'rejects an invalid path before fetching: %s',
    (path) => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      expect(() => setup().client.get(path, undefined, isItem)).toThrow('Invalid public path');
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
