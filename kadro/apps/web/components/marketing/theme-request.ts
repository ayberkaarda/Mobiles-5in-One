import {
  parseThemePreference,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE_DAYS,
  THEME_FIELD,
  THEME_RETURN_FIELD,
} from './theme';

/**
 * The colour-scheme toggle's POST (`app/tema/route.ts`, ADR-0084). It works without JavaScript:
 * the footer form posts `tema` (system | light | dark) and `geri` (the current path), the handler
 * stores the preference in a cookie and answers `303 See Other` back to that path.
 *
 * The route lives outside `/api`, so neither the API wrapper nor the CORS rules apply; it carries
 * its own checks. Only a same-origin browser form is accepted: the `Origin` header must be the
 * web origin (or, when a browser omits it, `Sec-Fetch-Site` must be `same-origin`), the body must
 * be a small URL-encoded form and the value one of the three preferences. The cookie carries no
 * authority, so this is hygiene rather than CSRF defence, but a cross-site page still cannot flip
 * a visitor's scheme. The return target is reduced to a path on the web origin: anything else,
 * including protocol-relative and backslash forms, falls back to `/`, so there is no open
 * redirect. Nothing is stored on the server.
 */

/** Upper bound of the form body; the real form is under 100 bytes. */
export const THEME_BODY_LIMIT_BYTES = 2048;

/** Upper bound of a return path. */
export const RETURN_PATH_MAX = 512;

const FORM_CONTENT_TYPE = 'application/x-www-form-urlencoded';

const MAX_AGE_SECONDS = THEME_COOKIE_MAX_AGE_DAYS * 24 * 60 * 60;

function plain(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** True when a control character or a backslash occurs (some clients treat `\` as `/`). */
function hasUnsafeCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code === 0x7f || code === 0x5c) {
      return true;
    }
  }
  return false;
}

/**
 * The path to send the visitor back to: `value` when it is a plain absolute path on
 * `webOrigin`, reduced to its path (query and fragment dropped); `/` otherwise.
 */
export function safeReturnPath(value: unknown, webOrigin: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > RETURN_PATH_MAX ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    hasUnsafeCharacter(value)
  ) {
    return '/';
  }
  try {
    const origin = new URL(webOrigin).origin;
    const target = new URL(value, origin);
    return target.origin === origin ? target.pathname : '/';
  } catch {
    return '/';
  }
}

/** True when the request comes from a page of `webOrigin`. */
export function isSameOriginRequest(headers: Headers, webOrigin: string): boolean {
  const origin = headers.get('origin');
  if (origin !== null) {
    try {
      return origin === new URL(webOrigin).origin;
    } catch {
      return false;
    }
  }
  return headers.get('sec-fetch-site') === 'same-origin';
}

/** The body as text, or `null` once it exceeds {@link THEME_BODY_LIMIT_BYTES}. */
async function boundedText(request: Request): Promise<string | null> {
  const declared = request.headers.get('content-length');
  if (declared !== null && Number(declared) > THEME_BODY_LIMIT_BYTES) {
    return null;
  }
  if (request.body === null) {
    return '';
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > THEME_BODY_LIMIT_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** `Set-Cookie` value that stores `preference` for a year on the whole site. */
export function themeCookieHeader(preference: string): string {
  return `${THEME_COOKIE}=${preference}; Path=/; Max-Age=${String(MAX_AGE_SECONDS)}; SameSite=Lax; Secure; HttpOnly`;
}

/** Handles `POST /tema` for the web origin `webOrigin`. */
export async function handleThemePreference(
  request: Request,
  webOrigin: string,
): Promise<Response> {
  if (!isSameOriginRequest(request.headers, webOrigin)) {
    return plain(403, 'Bu istek kabul edilmedi.');
  }
  const contentType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim();
  if (contentType?.toLowerCase() !== FORM_CONTENT_TYPE) {
    return plain(415, 'Bu istek kabul edilmedi.');
  }
  const text = await boundedText(request);
  if (text === null) {
    return plain(413, 'Bu istek kabul edilmedi.');
  }
  const form = new URLSearchParams(text);
  const values = form.getAll(THEME_FIELD);
  const preference = values.length === 1 ? parseThemePreference(values[0]) : null;
  if (preference === null) {
    return plain(400, 'Geçersiz tema seçimi.');
  }
  const returns = form.getAll(THEME_RETURN_FIELD);
  const path = safeReturnPath(returns.length === 1 ? returns[0] : undefined, webOrigin);
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL(path, new URL(webOrigin).origin).href,
      'Set-Cookie': themeCookieHeader(preference),
      'Cache-Control': 'no-store',
    },
  });
}
