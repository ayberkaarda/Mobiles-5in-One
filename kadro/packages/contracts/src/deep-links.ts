import { opaqueTokenSchema } from './common.js';
import { slugSchema } from './districts.js';
import { inviteCodeSchema } from './teams.js';

/**
 * Deep links and universal / app links (spec §7 "App linking", ADR-0045).
 *
 * One path set serves the web pages, the custom scheme and the verified https links, so a link
 * shared from the web opens the same screen in the app:
 * - `/mac/<code>`: team invite landing (ADR-0034). The spec's `kadro://match/[code]` names this
 *   link; it is a team invite, not a match, and the path keeps the Turkish web slug (ADR-0045).
 * - `/saha/<slug>`: venue page.
 * - `/eksik-var/<il>/<ilce>`: open calls of a district.
 * - `/e-posta-dogrula#token=…`, `/sifre-sifirla#token=…`: email links (ADR-0027, ADR-0040); the
 *   token stays in the fragment and is never sent to a server by the browser.
 *
 * Parsing uses plain string operations, never `URL`, because the React Native runtime implements
 * only part of the WHATWG URL API. A link only navigates: every action it leads to needs an
 * explicit tap and server-side authorization (threat model T-MOB-03).
 */

/** Custom scheme registered by the app (`scheme` in the Expo config). */
export const APP_SCHEME = 'kadro';

/** iOS bundle identifier and Android application id of the app. */
export const MOBILE_APP_IDS = {
  iosBundleId: 'app.kadro.mobile',
  androidPackage: 'app.kadro.mobile',
} as const;

/** First path segment of each link kind (Turkish web slugs). */
export const DEEP_LINK_SEGMENTS = {
  teamInvite: 'mac',
  venue: 'saha',
  openCalls: 'eksik-var',
  verifyEmail: 'e-posta-dogrula',
  resetPassword: 'sifre-sifirla',
} as const;

/**
 * Path patterns opened in the app when the user follows an https link: the
 * `apple-app-site-association` components and the Android intent filter path prefixes.
 */
export const APP_LINK_PATH_PATTERNS = [
  '/mac/*',
  '/saha/*',
  '/eksik-var/*',
  '/e-posta-dogrula',
  '/sifre-sifirla',
] as const;

export type DeepLinkTarget =
  | { readonly kind: 'teamInvite'; readonly code: string }
  | { readonly kind: 'venue'; readonly slug: string }
  | { readonly kind: 'openCalls'; readonly provinceSlug: string; readonly districtSlug: string }
  | { readonly kind: 'verifyEmail'; readonly token: string }
  | { readonly kind: 'resetPassword'; readonly token: string };

export type DeepLinkKind = DeepLinkTarget['kind'];

/** Path (and fragment for email links) of a target, e.g. `/mac/<code>`. */
export function deepLinkPath(target: DeepLinkTarget): string {
  switch (target.kind) {
    case 'teamInvite':
      return `/${DEEP_LINK_SEGMENTS.teamInvite}/${target.code}`;
    case 'venue':
      return `/${DEEP_LINK_SEGMENTS.venue}/${target.slug}`;
    case 'openCalls':
      return `/${DEEP_LINK_SEGMENTS.openCalls}/${target.provinceSlug}/${target.districtSlug}`;
    case 'verifyEmail':
      return `/${DEEP_LINK_SEGMENTS.verifyEmail}#token=${target.token}`;
    case 'resetPassword':
      return `/${DEEP_LINK_SEGMENTS.resetPassword}#token=${target.token}`;
  }
}

/** Custom-scheme link, e.g. `kadro://mac/<code>`. */
export function appDeepLink(target: DeepLinkTarget): string {
  return `${APP_SCHEME}://${deepLinkPath(target).slice(1)}`;
}

/** https link on the web origin (`https://kadro.app/mac/<code>`); `origin` has no trailing slash. */
export function webDeepLink(origin: string, target: DeepLinkTarget): string {
  return `${origin}${deepLinkPath(target)}`;
}

function valid(schema: { safeParse: (value: unknown) => { success: boolean } }, value: string) {
  return schema.safeParse(value).success;
}

/** Path and fragment of a link: custom scheme, an https link on an allowed origin, or a path. */
function splitLink(
  link: string,
  allowedOrigins: readonly string[],
): { path: string; fragment: string } | null {
  let rest: string;
  const schemePrefix = `${APP_SCHEME}://`;
  if (link.startsWith(schemePrefix)) {
    rest = `/${link.slice(schemePrefix.length)}`;
  } else if (link.startsWith('/')) {
    rest = link;
  } else {
    const origin = allowedOrigins.find(
      (candidate) =>
        link === candidate || link.startsWith(`${candidate}/`) || link.startsWith(`${candidate}#`),
    );
    if (origin === undefined) {
      return null;
    }
    rest = link.slice(origin.length) || '/';
  }
  const hashAt = rest.indexOf('#');
  const beforeHash = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : rest.slice(hashAt + 1);
  const queryAt = beforeHash.indexOf('?');
  const path = queryAt === -1 ? beforeHash : beforeHash.slice(0, queryAt);
  return { path: path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path, fragment };
}

/**
 * Exactly one `token` key with a well-formed value, as the web email-link pages require; a
 * repeated or empty key is rejected. Other keys are ignored and the value is never decoded.
 */
function fragmentToken(fragment: string): string | null {
  const values: string[] = [];
  for (const part of fragment.split('&')) {
    const separator = part.indexOf('=');
    const key = separator < 0 ? part : part.slice(0, separator);
    if (key === 'token') {
      values.push(separator < 0 ? '' : part.slice(separator + 1));
    }
  }
  const [only] = values;
  return values.length === 1 && only !== undefined && valid(opaqueTokenSchema, only) ? only : null;
}

/**
 * Recognizes a link the app should open. Accepts `kadro://…`, a bare path, or an https link whose
 * origin is listed in `allowedOrigins` (exact origins such as `https://kadro.app`). Anything else,
 * including a malformed code, slug or token, returns `null`; the caller then opens the home screen.
 */
export function parseDeepLink(
  link: string,
  allowedOrigins: readonly string[] = [],
): DeepLinkTarget | null {
  const parts = splitLink(link.trim(), allowedOrigins);
  if (parts === null) {
    return null;
  }
  const segments = parts.path.split('/').slice(1);
  const [first, second, third, ...extra] = segments;
  if (extra.length > 0) {
    return null;
  }
  switch (first) {
    case DEEP_LINK_SEGMENTS.teamInvite:
      return second !== undefined && third === undefined && valid(inviteCodeSchema, second)
        ? { kind: 'teamInvite', code: second }
        : null;
    case DEEP_LINK_SEGMENTS.venue:
      return second !== undefined && third === undefined && valid(slugSchema, second)
        ? { kind: 'venue', slug: second }
        : null;
    case DEEP_LINK_SEGMENTS.openCalls:
      return second !== undefined &&
        third !== undefined &&
        valid(slugSchema, second) &&
        valid(slugSchema, third)
        ? { kind: 'openCalls', provinceSlug: second, districtSlug: third }
        : null;
    case DEEP_LINK_SEGMENTS.verifyEmail:
    case DEEP_LINK_SEGMENTS.resetPassword: {
      if (second !== undefined) {
        return null;
      }
      // Presence check only; the token is compared by the server, never here.
      const fromFragment = fragmentToken(parts.fragment);
      if (fromFragment === null) {
        return null;
      }
      return first === DEEP_LINK_SEGMENTS.verifyEmail
        ? { kind: 'verifyEmail', token: fromFragment }
        : { kind: 'resetPassword', token: fromFragment };
    }
    default:
      return null;
  }
}
