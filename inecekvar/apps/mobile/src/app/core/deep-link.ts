/**
 * App links opened in the native shell (Capacitor `appUrlOpen`). Only https links on the two
 * product hosts are routed, and only these paths:
 *
 * - `/hat/{slug}` and `/{city}/hat/{slug}` (the web line page) open the line page;
 * - `/durak/{slug}` and `/{city}/durak/{slug}` open the stop page;
 * - `/giris/baglanti` opens the magic-link page (the `#token=` fragment is read by the session
 *   store, never put into the route).
 *
 * Slugs must be lower-case ASCII words joined by single hyphens (no encoding, no dots), at most
 * 120 characters, and a `?city=` query must be one too. Anything else, including another host,
 * a port, credentials in the URL or plain http, goes to the not-found page. No other query value
 * and no fragment is carried into the app route.
 */
export const APP_LINK_HOSTS: readonly string[] = ['inecekvar.app', 'app.inecekvar.app'];

export const NOT_FOUND_PATH = '/bulunamadi';
export const MAGIC_LINK_PATH = '/giris/baglanti';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 120;

export type DeepLinkTarget =
  | { kind: 'route'; path: string }
  | { kind: 'magic-link'; path: typeof MAGIC_LINK_PATH }
  | { kind: 'not-found'; path: typeof NOT_FOUND_PATH };

const notFound: DeepLinkTarget = { kind: 'not-found', path: NOT_FOUND_PATH };

export function isSlug(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.length <= MAX_SLUG && SLUG.test(value);
}

export function resolveDeepLink(raw: string): DeepLinkTarget {
  if (typeof raw !== 'string' || raw.length > 2048) return notFound;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return notFound;
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !APP_LINK_HOSTS.includes(url.hostname)
  ) {
    return notFound;
  }
  const parts = url.pathname.split('/');
  // A leading slash gives one empty part; allow one trailing slash, nothing else empty.
  if (parts[0] !== '') return notFound;
  const segments = parts.slice(1);
  if (segments.length > 1 && segments[segments.length - 1] === '') segments.pop();
  if (segments.some((s) => s === '')) return notFound;

  if (segments.length === 2 && segments[0] === 'giris' && segments[1] === 'baglanti') {
    return { kind: 'magic-link', path: MAGIC_LINK_PATH };
  }

  let city: string | null = null;
  let kind: string | undefined;
  let slug: string | undefined;
  if (segments.length === 2) {
    [kind, slug] = segments;
    const queryCity = url.searchParams.get('city');
    if (queryCity !== null) {
      if (!isSlug(queryCity)) return notFound;
      city = queryCity;
    }
  } else if (segments.length === 3) {
    const [first, second, third] = segments;
    if (!isSlug(first)) return notFound;
    city = first;
    kind = second;
    slug = third;
  } else {
    return notFound;
  }
  if ((kind !== 'hat' && kind !== 'durak') || !isSlug(slug)) return notFound;
  const path = `/${kind}/${slug}`;
  return { kind: 'route', path: city === null ? path : `${path}?city=${city}` };
}
