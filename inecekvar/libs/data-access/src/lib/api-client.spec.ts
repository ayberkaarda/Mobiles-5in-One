import { TestBed } from '@angular/core/testing';
import {
  bodyResponse,
  FakeFetch,
  hang,
  hangingBody,
  hangingBodyWith,
  json,
  noContent,
  problem,
} from '../testing/fake-fetch';
import { type Harness, setupDataAccess } from '../testing/setup';
import { ApiClient } from './api-client';
import { ApiError, parseRetryAfter } from './api-error';
import { AccountApi, CatalogApi, ContributionApi } from './endpoints';

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

const PLAN = {
  city: 'ornek',
  from: { lat: 39.9, lng: 32.8 },
  to: { lat: 39.95, lng: 32.85 },
  max_transfers: 1,
};

describe('ApiClient', () => {
  let h: Harness;
  let fake: FakeFetch;

  beforeEach(() => {
    h = setupDataAccess(false, 20);
    fake = h.fake;
  });

  it('builds typed paths and queries and sends a request id', async () => {
    fake.on(
      'GET',
      '/lines',
      json([{ code: 'ORN-1', id: '1', mode: 'dolmus', name: 'A', slug: 'a' }]),
    );
    const lines = await TestBed.inject(CatalogApi).lines({
      city: 'ornek',
      q: 'kızılay 1',
      limit: undefined,
    });
    expect(lines[0]?.code).toBe('ORN-1');
    const [call] = fake.calls;
    expect(call?.url).toBe('https://api.test/v1/lines?city=ornek&q=k%C4%B1z%C4%B1lay+1');
    expect(call?.headers.get('Accept')).toBe('application/json');
    expect(call?.headers.get('X-Request-ID')).toMatch(/^[A-Za-z0-9-]{8,64}$/);
  });

  it('sends the city on line and stop reads and encodes path parameters', async () => {
    fake.on('GET', '/lines/a%2Fb', json({})).on('GET', '/stops/s-1', json({}));
    fake.on('GET', '/lines/a%2Fb/versions', json([]));
    const catalog = TestBed.inject(CatalogApi);
    await catalog.line('a/b', 'ornek');
    await catalog.lineVersions('a/b', 'ornek');
    await catalog.stop('s-1', 'ornek');
    expect(fake.calls.map((c) => c.url)).toEqual([
      'https://api.test/v1/lines/a%2Fb?city=ornek',
      'https://api.test/v1/lines/a%2Fb/versions?city=ornek',
      'https://api.test/v1/stops/s-1?city=ornek',
    ]);
  });

  it('marks pack downloads with X-Pack-Request: 1', async () => {
    fake.on('GET', '/cities/ornek/pack', json({ pack_version: 3 }));
    await expect(TestBed.inject(CatalogApi).pack('ornek')).resolves.toEqual({ pack_version: 3 });
    expect(fake.calls[0]?.headers.get('X-Pack-Request')).toBe('1');
  });

  it('covers the remaining endpoints with their methods and bodies', async () => {
    fake
      .on('GET', '/cities', json([]))
      .on('GET', '/cities/ornek', json({}))
      .on('GET', '/stops/near', json([]))
      .on('POST', '/plan', json({ city: 'ornek', degraded: false, itineraries: [] }))
      .on('GET', '/me/favorites', json([]))
      .on('PUT', '/me/favorites/l1', noContent())
      .on('DELETE', '/me/favorites/l1', noContent())
      .on('GET', '/me/favorites/l1', json({}))
      .on('PATCH', '/me', json({}))
      .on('GET', '/edits', json([]))
      .on('GET', '/edits/e1', json({}))
      .on('POST', '/edits', json({}, 201))
      .on('POST', '/traces', json({}, 201))
      .on('GET', '/traces/t1', json({}))
      .on('DELETE', '/traces/t1', noContent())
      .on('POST', '/media/presign', json({}, 201));
    const catalog = TestBed.inject(CatalogApi);
    const account = TestBed.inject(AccountApi);
    const contrib = TestBed.inject(ContributionApi);
    await catalog.cities();
    await catalog.city('ornek');
    await catalog.stopsNear({ lat: 39.9, lng: 32.8, radius: 300 });
    await catalog.plan(PLAN);
    await account.favorites();
    await expect(account.addFavorite('l1')).resolves.toBeUndefined();
    await account.removeFavorite('l1');
    await account.favorite('l1');
    await account.updateDisplayName('Deniz');
    await contrib.myEdits({ limit: 10 });
    await contrib.edit('e1');
    await contrib.proposeEdit({ kind: 'retire', line: 'a', reason: 'Hat kalktı' });
    await contrib.uploadTrace({
      city: 'ornek',
      started_at: '2026-10-12T09:00:00Z',
      ended_at: '2026-10-12T09:20:00Z',
      points: [[32.8, 39.9]],
    });
    await contrib.trace('t1');
    await contrib.deleteTrace('t1');
    await contrib.presignPhoto({ kind: 'stop_sign', content_type: 'image/webp', byte_size: 1000 });
    expect(
      fake.calls.map((c) => `${c.method} ${c.url.replace('https://api.test/v1', '')}`),
    ).toEqual([
      'GET /cities',
      'GET /cities/ornek',
      'GET /stops/near?lat=39.9&lng=32.8&radius=300',
      'POST /plan',
      'GET /me/favorites',
      'PUT /me/favorites/l1',
      'DELETE /me/favorites/l1',
      'GET /me/favorites/l1',
      'PATCH /me',
      'GET /edits?limit=10',
      'GET /edits/e1',
      'POST /edits',
      'POST /traces',
      'GET /traces/t1',
      'DELETE /traces/t1',
      'POST /media/presign',
    ]);
    expect(fake.callsTo('POST', '/plan')[0]?.body).toEqual(PLAN);
    expect(fake.callsTo('POST', '/plan')[0]?.headers.get('Content-Type')).toBe('application/json');
    expect(fake.callsTo('PATCH', '/me')[0]?.body).toEqual({ display_name: 'Deniz' });
  });

  it('parses an RFC 9457 problem into a typed error', async () => {
    fake.on('GET', '/cities/x', problem(404, 'not_found', {}, 'srv-req-404'));
    const error = await failure(TestBed.inject(CatalogApi).city('x'));
    expect(error.kind).toBe('problem');
    expect(error.status).toBe(404);
    expect(error.code).toBe('not_found');
    expect(error.requestId).toBe('srv-req-404');
    expect(error.message).toBe('not_found (HTTP 404)');
  });

  it('reports a non-problem error page as http with the response request id', async () => {
    fake.on(
      'GET',
      '/cities',
      new Response('<html>bad gateway</html>', {
        status: 502,
        headers: { 'Content-Type': 'text/html', 'X-Request-ID': 'proxy-req-1' },
      }),
    );
    const error = await failure(TestBed.inject(CatalogApi).cities());
    expect(error).toMatchObject({
      kind: 'http',
      status: 502,
      code: 'http.502',
      requestId: 'proxy-req-1',
    });
  });

  it('falls back to the request id it sent', async () => {
    fake.on('GET', '/cities', new Response('', { status: 500 }));
    const error = await failure(TestBed.inject(CatalogApi).cities());
    expect(error.requestId).toBe(fake.calls[0]?.headers.get('X-Request-ID'));
  });

  it('retries an idempotent request once after a short Retry-After', async () => {
    fake.on('GET', '/cities', problem(429, 'rate_limited', { 'Retry-After': '2' }), json([]));
    await expect(TestBed.inject(CatalogApi).cities()).resolves.toEqual([]);
    expect(h.sleeps).toEqual([2000]);
    expect(fake.calls).toHaveLength(2);
    expect(fake.calls[0]?.headers.get('X-Request-ID')).toBe(
      fake.calls[1]?.headers.get('X-Request-ID'),
    );
    expect(TestBed.inject(ApiClient).rateLimitedUntil()).toBe(h.clock.now + 2000);
  });

  it('surfaces a long Retry-After without waiting', async () => {
    fake.on('GET', '/cities', problem(429, 'rate_limited', { 'Retry-After': '120' }));
    const error = await failure(TestBed.inject(CatalogApi).cities());
    expect(error).toMatchObject({ kind: 'rate_limited', status: 429, retryAfterSeconds: 120 });
    expect(h.sleeps).toEqual([]);
    expect(fake.calls).toHaveLength(1);
  });

  it('never replays a POST after 429 and retries a GET only once', async () => {
    fake.on('POST', '/plan', problem(429, 'rate_limited', { 'Retry-After': '1' }));
    const planError = await failure(TestBed.inject(CatalogApi).plan(PLAN));
    expect(planError.retryAfterSeconds).toBe(1);
    expect(fake.callsTo('POST', '/plan')).toHaveLength(1);

    fake.on('GET', '/cities', problem(429, 'rate_limited', { 'Retry-After': '1' }));
    await failure(TestBed.inject(CatalogApi).cities());
    expect(fake.callsTo('GET', '/cities')).toHaveLength(2);
  });

  it('reads Retry-After as seconds or an HTTP date', () => {
    const now = Date.parse('2026-10-12T10:00:00Z');
    expect(parseRetryAfter('7', now)).toBe(7);
    expect(parseRetryAfter('Mon, 12 Oct 2026 10:00:30 GMT', now)).toBe(30);
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  it('turns a transport failure into a network error', async () => {
    fake.on('GET', '/cities', () => Promise.reject(new TypeError('Failed to fetch')));
    const error = await failure(TestBed.inject(CatalogApi).cities());
    expect(error).toMatchObject({ kind: 'network', status: 0, code: 'network' });
  });

  it('aborts after the timeout', async () => {
    fake.on('GET', '/cities', hang);
    const error = await failure(TestBed.inject(CatalogApi).cities());
    expect(error.kind).toBe('timeout');
  });

  it('reports a caller cancellation as aborted', async () => {
    fake.on('GET', '/cities', hang);
    const controller = new AbortController();
    const pending = failure(TestBed.inject(CatalogApi).cities(controller.signal));
    controller.abort();
    expect((await pending).kind).toBe('aborted');
  });

  it('rejects a 2xx body that is not JSON', async () => {
    fake.on('GET', '/cities', new Response('<html>', { status: 200 }));
    const error = await failure(TestBed.inject(CatalogApi).cities());
    expect(error.kind).toBe('invalid_response');
  });

  it('times out while reading a success body after headers arrive', async () => {
    fake.on('GET', '/cities', hangingBody);
    const error = await failure(TestBed.inject(CatalogApi).cities());
    expect(error.kind).toBe('timeout');
  });

  it('keeps caller cancellation active while reading the body', async () => {
    fake.on('GET', '/cities', hangingBody);
    const controller = new AbortController();
    const pending = failure(TestBed.inject(CatalogApi).cities(controller.signal));
    await vi.waitFor(() => expect(fake.callsTo('GET', '/cities')).toHaveLength(1), { interval: 1 });
    controller.abort();
    expect((await pending).kind).toBe('aborted');
  });

  it('normalizes a body stream failure as a network error', async () => {
    fake.on('GET', '/cities', () =>
      bodyResponse(() => Promise.reject(new TypeError('connection lost'))),
    );
    const error = await failure(TestBed.inject(CatalogApi).cities());
    expect(error.kind).toBe('network');
  });

  it('times out while reading an error body after headers arrive', async () => {
    fake.on(
      'GET',
      '/cities',
      hangingBodyWith({ status: 503, headers: { 'Content-Type': 'application/problem+json' } }),
    );
    const error = await failure(TestBed.inject(CatalogApi).cities());
    expect(error.kind).toBe('timeout');
  });

  it('tracks requests in flight as a signal', async () => {
    let release: (r: Response) => void = () => undefined;
    fake.on('GET', '/cities', () => new Promise<Response>((resolve) => (release = resolve)));
    const client = TestBed.inject(ApiClient);
    const pending = TestBed.inject(CatalogApi).cities();
    expect(client.busy()).toBe(true);
    await vi.waitFor(() => expect(fake.calls).toHaveLength(1));
    release(json([]));
    await pending;
    expect(client.busy()).toBe(false);
  });

  it('refuses a path with a missing parameter', async () => {
    await expect(
      TestBed.inject(ApiClient).request({
        method: 'GET',
        path: '/cities/{slug}',
        params: { slug: '' },
      }),
    ).rejects.toThrow('missing path parameter slug');
  });
});
