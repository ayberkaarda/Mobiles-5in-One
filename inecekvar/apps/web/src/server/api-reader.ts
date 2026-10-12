import { assertPublicPath } from '../app/public-path';

export type ApiReadResult<T> =
  { ok: true; data: T } | { ok: false; kind: 'not_found' | 'unavailable' };

export interface ApiReader {
  read<T>(
    path: string,
    query: Readonly<Record<string, string | number>> | undefined,
    guard: (value: unknown) => value is T,
  ): Promise<ApiReadResult<T>>;
}

export function createApiReader(options: {
  baseUrl: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}): ApiReader {
  const request = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 3000;
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;

  return {
    async read<T>(
      path: string,
      query: Readonly<Record<string, string | number>> | undefined,
      guard: (value: unknown) => value is T,
    ): Promise<ApiReadResult<T>> {
      try {
        assertPublicPath(path);
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(query ?? {})) {
          search.set(key, String(value));
        }
        search.sort();
        const queryText = search.toString();
        const signal = AbortSignal.timeout(timeoutMs);
        const response = await request(
          options.baseUrl.replace(/\/$/, '') + path + (queryText ? '?' + queryText : ''),
          {
            method: 'GET',
            headers: { Accept: 'application/json' },
            credentials: 'omit',
            redirect: 'error',
            signal,
          },
        );
        if (!response.ok) {
          await response.body?.cancel();
          return {
            ok: false,
            kind: response.status === 404 || response.status === 410 ? 'not_found' : 'unavailable',
          };
        }
        const length = response.headers.get('content-length');
        if (length !== null && Number(length) > maxBytes) {
          await response.body?.cancel();
          return { ok: false, kind: 'unavailable' };
        }
        if (!response.body) return { ok: false, kind: 'unavailable' };
        const stream = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let bytes = 0;
        try {
          while (true) {
            const chunk = await stream.read();
            signal.throwIfAborted();
            if (chunk.done) break;
            bytes += chunk.value.byteLength;
            if (bytes > maxBytes) {
              await stream.cancel();
              return { ok: false, kind: 'unavailable' };
            }
            chunks.push(chunk.value);
          }
        } finally {
          stream.releaseLock();
        }
        const body: unknown = JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
        return guard(body) ? { ok: true, data: body } : { ok: false, kind: 'unavailable' };
      } catch {
        return { ok: false, kind: 'unavailable' };
      }
    },
  };
}
