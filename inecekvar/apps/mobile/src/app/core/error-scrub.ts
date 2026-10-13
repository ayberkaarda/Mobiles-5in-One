/**
 * Error report scrub (spec section 6 item 14, ADR-0054): the `beforeSend` hook an error
 * reporting SDK would call. No SDK is installed and nothing imports this file at runtime: it is
 * an inert helper until an owner adds an SDK and a DSN (docs/ops/logging.md, wiring point).
 * `apps/web/src/app/error-scrub.ts` holds the same rules; keep the two in step.
 *
 * Rules: credential, cookie, token and secret keys are dropped; request bodies, cookies and
 * query strings are dropped; the user keeps its id only; coordinate collections are dropped;
 * pairs of numbers and coordinate keys keep three decimals; text loses emails, bearer and basic
 * credentials, JSON Web Tokens, query strings and long decimal pairs.
 */

export type ScrubbedEvent = Record<string, unknown>;

const DROP_KEYS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'cookies',
  'set-cookie',
  'x-csrf-token',
  'csrf_token',
  'password',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'session',
  'secret',
  'client_secret',
  'api_key',
  'x-api-key',
  'code',
  'totp_code',
  'email',
]);
const GEOMETRY_KEYS = new Set([
  'coordinates',
  'points',
  'geometry',
  'polyline',
  'trace_points',
  'location',
  'locations',
]);
const COORDINATE_KEYS = new Set(['lat', 'lng', 'lon', 'latitude', 'longitude']);
const REQUEST_DROP = ['data', 'cookies', 'query_string', 'env'];

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const CREDENTIAL = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g;
const QUERY = /(\/[^\s"?]*?)(?:\?|%3[Ff])[^\s"]*/g;
const DECIMAL_PAIR = /(-?\d{1,3}\.\d{4,})(\s*,\s*)(-?\d{1,3}\.\d{4,})/g;

const round3 = (value: number): number => Math.round(value * 1000) / 1000;

export function scrubText(value: string): string {
  return value
    .replace(QUERY, '$1')
    .replace(CREDENTIAL, '$1 [redacted]')
    .replace(JWT, '[redacted-jwt]')
    .replace(
      DECIMAL_PAIR,
      (_match, first: string, gap: string, second: string) =>
        `${round3(Number(first)).toFixed(3)}${gap}${round3(Number(second)).toFixed(3)}`,
    )
    .replace(EMAIL, '[email]');
}

function isFraction(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Number.isInteger(value);
}

function clean(value: unknown, key: string): unknown {
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every(isFraction)) {
      return value.map((item) => round3(item as number));
    }
    return value.map((item) => clean(item, key));
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [name, item] of Object.entries(value as Record<string, unknown>)) {
      const lower = name.toLowerCase();
      if (DROP_KEYS.has(lower)) continue;
      if (GEOMETRY_KEYS.has(lower) && item !== null && typeof item === 'object') continue;
      result[scrubText(name)] = clean(item, lower);
    }
    return result;
  }
  if (typeof value === 'number' && COORDINATE_KEYS.has(key)) return round3(value);
  if (typeof value === 'string') return scrubText(value);
  return value;
}

/** Returns a scrubbed copy; the input is not changed. */
export function scrubEvent<T extends ScrubbedEvent>(event: T): T {
  const cleaned = clean(event, '') as ScrubbedEvent;
  const request = cleaned['request'];
  if (request !== null && typeof request === 'object' && !Array.isArray(request)) {
    for (const name of REQUEST_DROP) delete (request as ScrubbedEvent)[name];
  }
  const user = event['user'];
  if (user !== null && typeof user === 'object' && !Array.isArray(user)) {
    const id = (user as ScrubbedEvent)['id'];
    cleaned['user'] = id === undefined ? {} : { id };
  }
  delete cleaned['server_name'];
  return cleaned as T;
}

/**
 * The hook to pass as `beforeSend`, or `undefined` when no DSN is configured: without a DSN no
 * SDK should be initialised at all.
 */
export function beforeSendFor(
  dsn: string | null | undefined,
): ((event: ScrubbedEvent) => ScrubbedEvent) | undefined {
  return dsn && dsn.trim() !== '' ? scrubEvent : undefined;
}
