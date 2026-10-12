import { ApiError } from './api-error';

/** Header the API echoes and binds to its log lines (pattern `[A-Za-z0-9-]{8,64}`). */
export const REQUEST_ID_HEADER = 'X-Request-ID';

export function newRequestId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export interface SendOptions {
  timeoutMs: number;
  signal?: AbortSignal;
  requestId: string;
}

/**
 * One fetch with a timeout and an optional caller signal. Transport failures become an
 * `ApiError` of kind `network`, `timeout` or `aborted`; any HTTP answer is returned as is.
 */
export async function send(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  options: SendOptions,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs);
  if (options.signal?.aborted) {
    clearTimeout(timer);
    throw ApiError.noResponse('aborted', options.requestId);
  }
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch {
    if (timedOut) throw ApiError.noResponse('timeout', options.requestId);
    if (options.signal?.aborted) throw ApiError.noResponse('aborted', options.requestId);
    throw ApiError.noResponse('network', options.requestId);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
