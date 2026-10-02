import { isOpaqueToken } from './validation';

const TOKEN_IN_PARTS = /(?:^|[&?#])token=([^&#]*)/;

function tokenIn(part: string): string | null {
  const value = TOKEN_IN_PARTS.exec(part)?.[1];
  return value !== undefined && isOpaqueToken(value) ? value : null;
}

/**
 * The path of a link without scheme, host, query or fragment: `https://kadro.app/sifre-sifirla?x`
 * and `kadro://sifre-sifirla` both give `sifre-sifirla` (in the custom scheme the first segment
 * is the "host").
 */
function pathOf(url: string): string {
  const withoutParts = url.split('#')[0]?.split('?')[0] ?? '';
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(withoutParts);
  let rest = scheme === null ? withoutParts : withoutParts.slice(scheme[0].length);
  if (scheme !== null && /^https?$/i.test(scheme[1] ?? '')) {
    rest = rest.slice(rest.indexOf('/') + 1);
  }
  return rest.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * The emailed token of a verification or reset link for `path` (`e-posta-dogrula`,
 * `sifre-sifirla`). Email links carry it in the URL fragment (`/sifre-sifirla#token=...`,
 * ADR-0040); the custom scheme and router parameters may carry it as a query value, so the
 * fragment, the router parameter and the query are read in that order. A link for another path is
 * ignored, so a stale link from earlier cannot supply a token to the wrong screen. Returns `null`
 * when no well-formed token is present: the screen then shows the "link invalid" state without
 * calling the API.
 */
export function tokenFromLink(
  path: string,
  url: string | null | undefined,
  routeToken?: string | string[] | undefined,
): string | null {
  if (url !== null && url !== undefined && pathOf(url) === path) {
    const hash = url.indexOf('#');
    if (hash >= 0) {
      const fromFragment = tokenIn(url.slice(hash + 1));
      if (fromFragment !== null) {
        return fromFragment;
      }
    }
  }
  const routeValue = Array.isArray(routeToken) ? routeToken[0] : routeToken;
  if (routeValue !== undefined && isOpaqueToken(routeValue)) {
    return routeValue;
  }
  if (url !== null && url !== undefined && pathOf(url) === path) {
    const query = url.split('#')[0]?.split('?')[1];
    if (query !== undefined) {
      return tokenIn(query);
    }
  }
  return null;
}
