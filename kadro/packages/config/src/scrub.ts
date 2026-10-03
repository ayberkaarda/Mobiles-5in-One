/**
 * Error-event scrubbing (security checklist item 14, ADR-0074).
 *
 * `scrubEvent` is meant for an error-reporting SDK's `beforeSend` hook on web and mobile. It applies
 * the same rules as the server log redaction (`apps/web/lib/server/logging.ts`) to an event shaped
 * like a Sentry event, without depending on any SDK:
 *
 * - `request.cookies`, `request.data` (the body) and `user.ip_address` are removed;
 * - values under credential-like keys (cookie, authorization, set-cookie, password, token, secret,
 *   body, ...) are replaced with `[Redacted]` at any depth, including inside header objects and
 *   header pair arrays;
 * - email addresses are masked to `a***@d***` in every string;
 * - credential query parameters (`?token=...`, `&code=...`) are redacted in every string;
 * - long token-like strings (JWTs, bearer values, 32+ character key-shaped runs) are redacted in
 *   free text: message, log entry, exception values, extra, tags, breadcrumbs and request fields.
 *   Identifier fields (`event_id`, `release`, `sdk`, ...) are kept verbatim and `contexts`
 *   (trace ids) only gets key redaction and email masking.
 *
 * The input is never mutated; a scrubbed copy is returned. The module is pure and has no
 * dependencies, so the mobile bundle can import it.
 */

export const REDACTED = '[Redacted]';

const MAX_DEPTH = 12;

/** Normalised (lower case, no `-` or `_`) keys whose values are always redacted. */
const SECRET_KEYS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'cookies',
  'setcookie',
  'xcsrftoken',
  'csrftoken',
  'xapikey',
  'apikey',
  'password',
  'newpassword',
  'currentpassword',
  'passwd',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'identitytoken',
  'sessiontoken',
  'totp',
  'code',
  'secret',
  'clientsecret',
  'body',
  'requestbody',
  'responsebody',
]);

/** Query parameters whose values are redacted inside URLs and query strings. */
const SECRET_QUERY_PARAMS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'code',
  'password',
  'secret',
  'key',
  'apikey',
  'signature',
  'sig',
  'invite',
]);

/** Top-level event fields whose strings may carry free text, so token-like runs are redacted. */
const FREE_TEXT_FIELDS = new Set([
  'message',
  'logentry',
  'exception',
  'extra',
  'tags',
  'breadcrumbs',
  'request',
  'transaction',
]);

/** Top-level identifier fields that are kept verbatim (`kadro@1.4.0+42` is a release, not an email). */
const VERBATIM_FIELDS = new Set([
  'event_id',
  'release',
  'dist',
  'environment',
  'platform',
  'level',
  'timestamp',
  'start_timestamp',
  'type',
  'sdk',
]);

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(normaliseKey(key));
}

/** `ayberk@example.com` becomes `a***@e***`. */
export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0 || at === address.length - 1) {
    return '***';
  }
  return `${address.charAt(0)}***@${address.charAt(at + 1)}***`;
}

const EMAIL_IN_TEXT = /[^\s@<>"'(),;:/?&=]+@[^\s@<>"'(),;:/?&=]+\.[^\s@<>"'(),;:/?&=]+/g;
const QUERY_PARAM = /([?&;])([^=&#\s]+)=([^&#\s]*)/g;
const BEARER = /\b(bearer)\s+[^\s"',;]+/gi;
const JWT = /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]+/g;
const LONG_RUN = /[\w+/=.~-]{32,}/g;

function looksLikeToken(run: string): boolean {
  return /\d/.test(run) && /[a-z]/i.test(run) && !run.includes('..');
}

/** Masks emails and redacts credential query parameters. Safe for any string. */
function scrubAlways(text: string): string {
  return text
    .replace(QUERY_PARAM, (match, sep: string, name: string) =>
      SECRET_QUERY_PARAMS.has(normaliseKey(name)) ? `${sep}${name}=${REDACTED}` : match,
    )
    .replace(EMAIL_IN_TEXT, (match) => maskEmail(match));
}

/**
 * Scrubs free text: everything {@link scrubAlways} does plus bearer values, JWTs and long
 * token-like runs (at least 32 characters mixing letters and digits).
 */
export function scrubText(text: string): string {
  return scrubAlways(text)
    .replace(BEARER, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(LONG_RUN, (run) => (looksLikeToken(run) ? REDACTED : run));
}

interface Walk {
  readonly freeText: boolean;
  readonly seen: WeakSet<object>;
}

function scrubValue(value: unknown, walk: Walk, depth: number): unknown {
  if (typeof value === 'string') {
    return walk.freeText ? scrubText(value) : scrubAlways(value);
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH || walk.seen.has(value)) {
    return '[Truncated]';
  }
  walk.seen.add(value);
  try {
    if (Array.isArray(value)) {
      return scrubArray(value, walk, depth);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        isSecretKey(key) ? REDACTED : scrubValue(inner, walk, depth + 1),
      ]),
    );
  } finally {
    walk.seen.delete(value);
  }
}

/** Arrays of `[name, value]` pairs (header and query-string form) redact by name too. */
function scrubArray(items: readonly unknown[], walk: Walk, depth: number): unknown[] {
  return items.map((item) => {
    if (
      Array.isArray(item) &&
      item.length === 2 &&
      typeof item[0] === 'string' &&
      isSecretKey(item[0])
    ) {
      return [item[0], REDACTED];
    }
    return scrubValue(item, walk, depth + 1);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function withoutKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));
}

/** Query string as a string, an object or `[name, value]` pairs. */
function scrubQueryString(query: unknown, walk: Walk): unknown {
  if (typeof query === 'string') {
    const prefixed = query.startsWith('?') ? query : `?${query}`;
    const scrubbed = scrubText(prefixed);
    return query.startsWith('?') ? scrubbed : scrubbed.slice(1);
  }
  if (isRecord(query)) {
    return Object.fromEntries(
      Object.entries(query).map(([key, inner]) => [
        key,
        SECRET_QUERY_PARAMS.has(normaliseKey(key)) || isSecretKey(key)
          ? REDACTED
          : scrubValue(inner, walk, 1),
      ]),
    );
  }
  if (Array.isArray(query)) {
    return query.map((pair: unknown) =>
      Array.isArray(pair) &&
      typeof pair[0] === 'string' &&
      (SECRET_QUERY_PARAMS.has(normaliseKey(pair[0])) || isSecretKey(pair[0]))
        ? [pair[0], REDACTED]
        : scrubValue(pair, walk, 1),
    );
  }
  return scrubValue(query, walk, 1);
}

function scrubRequest(request: Record<string, unknown>, walk: Walk): Record<string, unknown> {
  const rest = withoutKeys(request, ['cookies', 'data']);
  return Object.fromEntries(
    Object.entries(rest).map(([key, inner]) => [
      key,
      key === 'query_string' ? scrubQueryString(inner, walk) : scrubValue(inner, walk, 1),
    ]),
  );
}

function scrubUser(user: Record<string, unknown>, walk: Walk): Record<string, unknown> {
  const rest = withoutKeys(user, ['ip_address']);
  return Object.fromEntries(
    Object.entries(rest).map(([key, inner]) => [
      key,
      key === 'email' && typeof inner === 'string'
        ? maskEmail(inner)
        : isSecretKey(key)
          ? REDACTED
          : scrubValue(inner, walk, 1),
    ]),
  );
}

/**
 * Returns a scrubbed copy of an error event. Non-object input is returned unchanged, so the
 * function can be passed straight to `beforeSend`.
 */
export function scrubEvent<T>(event: T): T {
  if (!isRecord(event)) {
    return event;
  }
  const seen = new WeakSet<object>([event]);
  const entries = Object.entries(event).map(([key, value]): [string, unknown] => {
    if (VERBATIM_FIELDS.has(key)) {
      return [key, value];
    }
    const walk: Walk = { freeText: FREE_TEXT_FIELDS.has(key), seen };
    if (key === 'request' && isRecord(value)) {
      return [key, scrubRequest(value, walk)];
    }
    if (key === 'user' && isRecord(value)) {
      return [key, scrubUser(value, walk)];
    }
    if (isSecretKey(key)) {
      return [key, REDACTED];
    }
    return [key, scrubValue(value, walk, 0)];
  });
  return Object.fromEntries(entries) as T;
}
