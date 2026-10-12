import type { SecureTokenStore } from '../lib/auth/secure-token-store';

export const TEST_API = 'https://api.test/v1';

export interface RecordedCall {
  url: string;
  method: string;
  headers: Headers;
  credentials: RequestCredentials | undefined;
  body: unknown;
}

export type Responder = (call: RecordedCall, signal?: AbortSignal) => Response | Promise<Response>;

interface Route {
  method: string;
  path: string;
  responders: Responder[];
}

/**
 * Scripted `fetch`: each route answers with its responders in order and repeats the last one.
 * Every call is recorded with its parsed JSON body.
 */
export class FakeFetch {
  readonly calls: RecordedCall[] = [];
  private readonly routes: Route[] = [];

  on(method: string, path: string, ...responders: (Responder | Response)[]): this {
    this.routes.push({
      method,
      path,
      responders: responders.map((r) => (typeof r === 'function' ? r : () => r.clone())),
    });
    return this;
  }

  callsTo(method: string, path: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method && matches(c.url, path));
  }

  readonly fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? 'GET').toUpperCase();
    const call: RecordedCall = {
      url,
      method,
      headers: new Headers(init?.headers),
      credentials: init?.credentials,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    this.calls.push(call);
    const route = this.routes.find((r) => r.method === method && matches(url, r.path));
    if (!route) throw new TypeError(`no fake route for ${method} ${url}`);
    const responder = route.responders.length > 1 ? route.responders.shift() : route.responders[0];
    if (!responder) throw new TypeError(`no responder for ${method} ${url}`);
    return responder(call, init?.signal ?? undefined);
  }) as typeof fetch;
}

function matches(url: string, path: string): boolean {
  const full = TEST_API + path;
  return url === full || url.startsWith(full + '?');
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export function problem(
  status: number,
  code: string,
  headers: Record<string, string> = {},
  requestId = 'srv-request-0001',
): Response {
  return new Response(
    JSON.stringify({
      type: `https://api.inecekvar.app/problems/${code}`,
      title: 'Error',
      status,
      code,
      request_id: requestId,
    }),
    { status, headers: { 'Content-Type': 'application/problem+json', ...headers } },
  );
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

/** A fetch that only settles when its signal aborts. */
export const hang: Responder = (_call, signal) =>
  new Promise<Response>((_resolve, reject) => {
    if (signal?.aborted) reject(new DOMException('aborted', 'AbortError'));
    signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });

export class MemoryTokenStore implements SecureTokenStore {
  value: string | null = null;
  readonly writes: string[] = [];

  async get(): Promise<string | null> {
    return this.value;
  }

  async set(token: string): Promise<void> {
    this.value = token;
    this.writes.push(token);
  }

  async clear(): Promise<void> {
    this.value = null;
  }
}

export const ME = {
  created_at: '2026-10-01T10:00:00Z',
  display_name: 'Deniz',
  email: 'deniz@example.test',
  email_verified: true,
  id: '01920000-0000-7000-8000-000000000001',
  licence_accepted: false,
  reputation: 0,
  role: 'user' as const,
};

export function cookieSignIn(csrf = 'csrf-from-login') {
  return { auth_mode: 'cookie' as const, csrf_token: csrf, user: ME };
}

export function bearerSignIn(access = 'access-1', refresh = 'refresh-1') {
  return {
    auth_mode: 'bearer' as const,
    access_token: access,
    refresh_token: refresh,
    expires_in: 900,
    token_type: 'Bearer' as const,
    user: ME,
  };
}

export function refreshed(access: string, refresh: string) {
  return { access_token: access, refresh_token: refresh, expires_in: 900, token_type: 'Bearer' };
}
