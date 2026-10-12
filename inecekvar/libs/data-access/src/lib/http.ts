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
 * `ApiError` of kind `network`, `timeout` or `aborted`, including body stream failures.
 */
export async function send<T>(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  options: SendOptions,
  reader: (response: Response) => Promise<T>,
): Promise<T> {
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
    const response = await fetchFn(url, { ...init, signal: controller.signal });
    return await reader(response);
  } catch (error) {
    if (timedOut) throw ApiError.noResponse('timeout', options.requestId);
    if (options.signal?.aborted) throw ApiError.noResponse('aborted', options.requestId);
    if (error instanceof ApiError) throw error;
    throw ApiError.noResponse('network', options.requestId);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onAbort);
  }
}

export async function readJson(response: Response, requestId: string): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApiError('invalid_response', response.status, 'invalid_response', requestId);
  }
}
