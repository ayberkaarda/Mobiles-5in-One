import { isOpaqueToken } from '../auth/validation';
import { type AuthStatus } from '../auth-store/store';
import { isInviteCode } from '../teams/invite-code';

/**
 * Deep links of the app (product spec §7 "App linking", ADR-0045, ADR-0075).
 *
 * The parser mirrors `parseDeepLink` in `packages/contracts/src/deep-links.ts`; the contracts
 * package is not bundled into the app (it brings zod), so the rules are restated here with plain
 * string operations and a test runs both parsers over the same links. A link only navigates:
 * joining a team, applying to a call or redeeming an email token always needs a tap on the
 * screen it opens (threat model T-MOB-03).
 */

export const APP_SCHEME = 'kadro';

/** First path segment of each link kind (Turkish web slugs, ADR-0045). */
export const LINK_SEGMENTS = {
  teamInvite: 'mac',
  venue: 'saha',
  openCalls: 'eksik-var',
  verifyEmail: 'e-posta-dogrula',
  resetPassword: 'sifre-sifirla',
} as const;

export type LinkTarget =
  | { readonly kind: 'teamInvite'; readonly code: string }
  | { readonly kind: 'venue'; readonly slug: string }
  | { readonly kind: 'openCalls'; readonly provinceSlug: string; readonly districtSlug: string }
  | { readonly kind: 'verifyEmail'; readonly token: string }
  | { readonly kind: 'resetPassword'; readonly token: string };

/** Targets behind the signed-in guard: a signed-out user is asked to sign in first. */
export type SessionLinkTarget = Extract<LinkTarget, { kind: 'teamInvite' | 'venue' | 'openCalls' }>;

const SLUG_MAX = 80;
const SLUG_PART = /^[a-z0-9]+$/;

/** Contracts `slugSchema`: 1..80 characters, lower-case ASCII words joined by single dashes. */
export function isSlug(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= SLUG_MAX &&
    value.split('-').every((part) => SLUG_PART.test(part))
  );
}

/** Origins accepted for https links: the configured web origin, when it is a bare https origin. */
export function allowedLinkOrigins(webOrigin: string | undefined): readonly string[] {
  if (webOrigin === undefined) {
    return [];
  }
  const origin = webOrigin.endsWith('/') ? webOrigin.slice(0, -1) : webOrigin;
  const prefix = 'https://';
  if (!origin.startsWith(prefix)) {
    return [];
  }
  const [host = '', port, ...more] = origin.slice(prefix.length).split(':');
  const valid =
    more.length === 0 &&
    /^[a-z0-9.-]+$/i.test(host) &&
    (port === undefined || /^[0-9]{1,5}$/.test(port));
  return valid ? [origin] : [];
}

interface LinkParts {
  readonly path: string;
  readonly fragment: string;
}

/** Path and fragment of a link on this app: `kadro://…`, a bare path, or an allowed https origin. */
function splitLink(link: string, allowedOrigins: readonly string[]): LinkParts | null {
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

/** Exactly one `token` key with a well-formed value; the value is never decoded. */
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
  return values.length === 1 && only !== undefined && isOpaqueToken(only) ? only : null;
}

/**
 * The target of a link the app should open, or `null` for anything else (another origin, an
 * unknown path, a malformed code, slug or token). Same result as the contracts' `parseDeepLink`.
 */
export function parseLink(link: string, allowedOrigins: readonly string[] = []): LinkTarget | null {
  const parts = splitLink(link.trim(), allowedOrigins);
  if (parts === null) {
    return null;
  }
  const [first, second, third, ...extra] = parts.path.split('/').slice(1);
  if (extra.length > 0) {
    return null;
  }
  switch (first) {
    case LINK_SEGMENTS.teamInvite:
      return second !== undefined && third === undefined && isInviteCode(second)
        ? { kind: 'teamInvite', code: second }
        : null;
    case LINK_SEGMENTS.venue:
      return second !== undefined && third === undefined && isSlug(second)
        ? { kind: 'venue', slug: second }
        : null;
    case LINK_SEGMENTS.openCalls:
      return second !== undefined && third !== undefined && isSlug(second) && isSlug(third)
        ? { kind: 'openCalls', provinceSlug: second, districtSlug: third }
        : null;
    case LINK_SEGMENTS.verifyEmail: {
      const token = second === undefined ? fragmentToken(parts.fragment) : null;
      return token === null ? null : { kind: 'verifyEmail', token };
    }
    case LINK_SEGMENTS.resetPassword: {
      const token = second === undefined ? fragmentToken(parts.fragment) : null;
      return token === null ? null : { kind: 'resetPassword', token };
    }
    default:
      return null;
  }
}

export function needsSession(target: LinkTarget): target is SessionLinkTarget {
  return target.kind === 'teamInvite' || target.kind === 'venue' || target.kind === 'openCalls';
}

/**
 * App route of a session target. The district link opens the Eksik Var tab with the district as
 * route parameters (the tab's own path is `/eksik-var`; ADR-0052 keeps other routes out of it).
 */
export function sessionLinkHref(target: SessionLinkTarget): string {
  switch (target.kind) {
    case 'teamInvite':
      return `/${LINK_SEGMENTS.teamInvite}/${target.code}`;
    case 'venue':
      return `/${LINK_SEGMENTS.venue}/${target.slug}`;
    case 'openCalls':
      return `/${LINK_SEGMENTS.openCalls}?il=${target.provinceSlug}&ilce=${target.districtSlug}`;
  }
}

/** Path part of an href (`/eksik-var?il=…` gives `/eksik-var`), compared with the router path. */
export function hrefPathname(href: string): string {
  const queryAt = href.indexOf('?');
  return queryAt === -1 ? href : href.slice(0, queryAt);
}

const KNOWN_SEGMENTS: readonly string[] = Object.values(LINK_SEGMENTS);

export interface IncomingLinkResult {
  /** Path the router opens, or `null` to leave the link to the router unchanged. */
  readonly path: string | null;
  /** A session target to open after sign-in (memory only), when the user is not signed in. */
  readonly pending: SessionLinkTarget | null;
}

/**
 * Decision for a link the operating system hands to the app (`+native-intent`):
 * - a recognized session target opens its route; when the user is not known to be signed in it is
 *   also returned as `pending`, so it can be opened after sign-in (the guard sends the user to the
 *   entry screen first);
 * - an email link, and a malformed link under one of the five paths, is left to its screen, which
 *   reads the token itself or shows the "link invalid" state;
 * - any other path on the app scheme or the web origin opens the home screen (ADR-0045:
 *   `kadro://match/<code>` is not a link);
 * - links of other schemes (development client, sign-in redirects) are not touched.
 */
export function routeIncomingLink(
  link: string,
  status: AuthStatus,
  allowedOrigins: readonly string[],
): IncomingLinkResult {
  const target = parseLink(link, allowedOrigins);
  if (target !== null && needsSession(target)) {
    return {
      path: sessionLinkHref(target),
      pending: status === 'signedIn' ? null : target,
    };
  }
  if (target !== null) {
    return { path: null, pending: null };
  }
  const parts = splitLink(link.trim(), allowedOrigins);
  if (parts === null) {
    return { path: null, pending: null };
  }
  const first = parts.path.split('/')[1] ?? '';
  return KNOWN_SEGMENTS.includes(first)
    ? { path: null, pending: null }
    : { path: '/', pending: null };
}

export type PendingLinkStep =
  | { readonly action: 'wait' }
  | { readonly action: 'clear' }
  | { readonly action: 'open'; readonly href: string };

/**
 * What the root layout does with a held link: nothing until the user is signed in; then open it,
 * unless the router already shows it (a signed-in start where the session was still being read
 * when the link arrived).
 */
export function pendingLinkStep(
  status: AuthStatus,
  pending: SessionLinkTarget | null,
  pathname: string,
): PendingLinkStep {
  if (pending === null || status !== 'signedIn') {
    return { action: 'wait' };
  }
  const href = sessionLinkHref(pending);
  return pathname === hrefPathname(href) && pending.kind !== 'openCalls'
    ? { action: 'clear' }
    : { action: 'open', href };
}
