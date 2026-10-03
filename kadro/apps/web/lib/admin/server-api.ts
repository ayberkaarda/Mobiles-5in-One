import { AUTH_CLIENT_HEADER, ERROR_CODES, type ErrorCode } from '@kadro/contracts';
import { districts } from '@kadro/db';
import { inArray } from 'drizzle-orm';
import { headers } from 'next/headers';
import { type z } from 'zod';

import { REQUEST_ID_HEADER } from '../server/request-context';
import { serverRuntime } from '../server/runtime';

/**
 * Server-side reads of the admin panel (ADR-0068). A server component never queries admin data
 * itself: it calls the `/api/v1` route handler in process with the browser's own cookies, so the
 * route wrapper applies exactly the checks a browser request gets (client header, session,
 * staff role, step-up window, strict query validation, policy gate, logging). Only the session
 * and CSRF cookies, the trusted client-address header and the request id are forwarded.
 */

export type RouteHandlerLike = (
  request: Request,
  context: { readonly params: Promise<unknown> },
) => Promise<Response>;

/** What a page does with an admin read. */
export type AdminRead<T> =
  | { readonly kind: 'ok'; readonly data: T }
  /** No valid web session (or a deactivated account): sign in again. */
  | { readonly kind: 'signed_out' }
  /** Staff without a live step-up window. */
  | { readonly kind: 'step_up' }
  /** Not staff, or a moderator on an admin-only read. */
  | { readonly kind: 'forbidden' }
  | { readonly kind: 'not_found' }
  /** The query was refused (bad filter or cursor). */
  | { readonly kind: 'invalid' }
  | { readonly kind: 'unavailable' };

const KNOWN_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

function problemCode(body: unknown): ErrorCode | null {
  if (typeof body !== 'object' || body === null || !('code' in body)) {
    return null;
  }
  const code = (body as { code: unknown }).code;
  return typeof code === 'string' && KNOWN_CODES.has(code) ? (code as ErrorCode) : null;
}

/** Maps a route response to an {@link AdminRead}; the body is checked against `schema`. */
export function interpretAdminResponse<T>(
  status: number,
  body: unknown,
  schema: z.ZodType<T>,
): AdminRead<T> {
  if (status === 200) {
    const parsed = schema.safeParse(body);
    return parsed.success ? { kind: 'ok', data: parsed.data } : { kind: 'unavailable' };
  }
  const code = problemCode(body);
  if (status === 401) {
    return code === 'step_up_required' ? { kind: 'step_up' } : { kind: 'signed_out' };
  }
  if (status === 403) {
    return code === 'csrf_failed' ? { kind: 'signed_out' } : { kind: 'forbidden' };
  }
  if (status === 404) {
    return { kind: 'not_found' };
  }
  if (status === 400) {
    return { kind: 'invalid' };
  }
  return { kind: 'unavailable' };
}

/** The headers forwarded from the page request to the in-process API request. */
export function forwardedHeaders(incoming: Pick<Headers, 'get'>, clientIpHeader: string): Headers {
  const forwarded = new Headers({ accept: 'application/json' });
  forwarded.set(AUTH_CLIENT_HEADER, 'web');
  for (const name of ['cookie', clientIpHeader.toLowerCase(), REQUEST_ID_HEADER]) {
    const value = incoming.get(name);
    if (value !== null) {
      forwarded.set(name, value);
    }
  }
  return forwarded;
}

/**
 * Query string from page search parameters: only `allowed` keys with a single string value are
 * passed on; the route's strict schema validates them.
 */
export function pickQuery(
  searchParams: Readonly<Record<string, string | string[] | undefined>>,
  allowed: readonly string[],
): Record<string, string> {
  const entries: [string, string][] = [];
  for (const [key, value] of Object.entries(searchParams)) {
    if (allowed.includes(key) && typeof value === 'string' && value !== '') {
      entries.push([key, value]);
    }
  }
  const query: Record<string, string> = Object.fromEntries(entries);
  return query;
}

export interface AdminReadOptions {
  /** Route pattern with concrete values, e.g. `/api/v1/admin/venues/import/<id>`. */
  readonly path: `/api/v1/${string}`;
  readonly query?: Readonly<Record<string, string>>;
  readonly params?: Readonly<Record<string, string>>;
}

/** Calls the GET route `handler` in process as the current browser session. */
export async function adminRead<T>(
  handler: RouteHandlerLike,
  schema: z.ZodType<T>,
  options: AdminReadOptions,
): Promise<AdminRead<T>> {
  const runtime = await serverRuntime();
  const url = new URL(options.path, runtime.env.WEB_ORIGIN);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    url.searchParams.set(key, value);
  }
  const request = new Request(url, {
    method: 'GET',
    headers: forwardedHeaders(await headers(), runtime.env.CLIENT_IP_HEADER),
  });
  try {
    const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
    const body: unknown = /json/i.test(response.headers.get('content-type') ?? '')
      ? await response.json()
      : null;
    return interpretAdminResponse(response.status, body, schema);
  } catch {
    return { kind: 'unavailable' };
  }
}

/** `il / ilçe` labels for the district ids on a page (public reference data). */
export async function districtLabels(ids: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const runtime = await serverRuntime();
  const rows = await runtime.db
    .select({ id: districts.id, il: districts.il, ilce: districts.ilce })
    .from(districts)
    .where(inArray(districts.id, unique));
  return new Map(rows.map((row) => [row.id, `${row.il} / ${row.ilce}`]));
}
