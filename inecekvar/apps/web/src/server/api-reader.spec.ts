// @vitest-environment node
import { apiPath } from '../app/data/public-api.client';
import { createApiReader } from './api-reader';

const baseUrl = 'http://127.0.0.1:57800/v1';
const unavailable = { ok: false, kind: 'unavailable' };

function isValue(value: unknown): value is { value: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

function fixture(response: () => Response, maxBytes?: number) {
  const request = vi.fn<typeof fetch>(async () => response());
  return { request, reader: createApiReader({ baseUrl, fetch: request, maxBytes }) };
}

describe('server API reader', () => {
  it('encodes each path parameter and query value and sends only the JSON accept header', async () => {
    const { reader, request } = fixture(() => Response.json({ value: 'ok' }));
    const slug = "a/b?c#d &.!'()*";
    const path = apiPath('/lines/{slug}', { slug });
    expect(await reader.read(path, { city: 'a/b &', page: 2 }, isValue)).toEqual({
      ok: true,
      data: { value: 'ok' },
    });
    expect(request.mock.calls[0]?.[0]).toBe(
      baseUrl + '/lines/a%2Fb%3Fc%23d%20%26%2E%21%27%28%29%2A?city=a%2Fb+%26&page=2',
    );
    const init = request.mock.calls[0]?.[1];
    expect(init).toEqual({
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'omit',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });

  it.each(['//other.test/value', '/lines/a?token=secret', '/a/../value'])(
    'rejects an unsafe path before fetching: %s',
    async (path) => {
      const { reader, request } = fixture(() => Response.json({ value: 'ok' }));
      expect(await reader.read(path, undefined, isValue)).toEqual(unavailable);
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each([404, 410])('returns not_found for %s without reading JSON', async (status) => {
    const response = new Response('private upstream text', { status });
    const cancel = vi.spyOn(response.body as ReadableStream<Uint8Array>, 'cancel');
    const { reader } = fixture(() => response);
    expect(await reader.read('/missing', undefined, isValue)).toEqual({
      ok: false,
      kind: 'not_found',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([301, 401, 429, 500])('returns unavailable for %s', async (status) => {
    const { reader } = fixture(() => new Response('private upstream text', { status }));
    expect(await reader.read('/value', undefined, isValue)).toEqual(unavailable);
  });

  it('returns unavailable when the request times out', async () => {
    const request = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) throw new Error('Missing timeout signal');
          signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const reader = createApiReader({ baseUrl, fetch: request, timeoutMs: 5 });
    expect(await reader.read('/value', undefined, isValue)).toEqual(unavailable);
    expect(request.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it('applies the timeout while reading a slow body', async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error('Missing timeout signal');
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
        },
      });
      return new Response(body);
    });
    const reader = createApiReader({ baseUrl, fetch: request, timeoutMs: 5 });
    expect(await reader.read('/value', undefined, isValue)).toEqual(unavailable);
  });

  it('rejects an oversized content-length before reading the body', async () => {
    const response = new Response('{"value":"ok"}', { headers: { 'content-length': '100' } });
    const getReader = vi.spyOn(response.body as ReadableStream<Uint8Array>, 'getReader');
    const { reader } = fixture(() => response, 20);
    expect(await reader.read('/value', undefined, isValue)).toEqual(unavailable);
    expect(getReader).not.toHaveBeenCalled();
  });

  it.each([undefined, '1'])('bounds streamed bytes with content-length %s', async (length) => {
    const cancel = vi.fn();
    const bytes = new TextEncoder().encode('şşşş');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 4));
        controller.enqueue(bytes.slice(4));
      },
      cancel,
    });
    const { reader } = fixture(
      () =>
        new Response(body, {
          headers: length === undefined ? {} : { 'content-length': length },
        }),
      6,
    );
    expect(await reader.read('/value', undefined, isValue)).toEqual(unavailable);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('accepts a valid body exactly at the byte limit', async () => {
    const body = '{"value":"ş"}';
    const { reader } = fixture(() => new Response(body), Buffer.byteLength(body, 'utf8'));
    expect(await reader.read('/value', undefined, isValue)).toEqual({
      ok: true,
      data: { value: 'ş' },
    });
  });

  it.each(['{', '', 'null', '{"value":42}'])(
    'rejects bad JSON or guard mismatch: %s',
    async (body) => {
      const { reader } = fixture(() => new Response(body));
      expect(await reader.read('/value', undefined, isValue)).toEqual(unavailable);
    },
  );

  it('rejects an empty success response', async () => {
    const { reader } = fixture(() => new Response(null, { status: 204 }));
    expect(await reader.read('/value', undefined, isValue)).toEqual(unavailable);
  });

  it('absorbs fetch errors without exposing their text', async () => {
    const request = vi.fn<typeof fetch>(async () => {
      throw new Error('private upstream text');
    });
    const reader = createApiReader({ baseUrl, fetch: request });
    expect(await reader.read('/value', undefined, isValue)).toEqual(unavailable);
  });
});
