/** Legal pages of the web app (product spec §7); their texts are labelled as samples. */
export const LEGAL_PAGES = [
  { key: 'privacy', path: '/gizlilik' },
  { key: 'kvkk', path: '/kvkk-aydinlatma' },
  { key: 'deletion', path: '/hesap-silme' },
] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number]['key'];

export interface LegalLink {
  readonly key: LegalPage;
  readonly url: string;
}

/**
 * Links to the legal pages on the configured web origin (`EXPO_PUBLIC_WEB_ORIGIN`, validated by
 * `@kadro/config/mobile`). Without an https origin (local builds) there are no links: the app
 * never guesses a host.
 */
export function legalLinks(webOrigin: string | undefined): readonly LegalLink[] {
  if (webOrigin === undefined || webOrigin === '') {
    return [];
  }
  let origin: string;
  try {
    const url = new URL(webOrigin);
    if (url.protocol !== 'https:') {
      return [];
    }
    origin = url.origin;
  } catch {
    return [];
  }
  return LEGAL_PAGES.map((page) => ({ key: page.key, url: `${origin}${page.path}` }));
}

export function legalLink(links: readonly LegalLink[], key: LegalPage): string | null {
  return links.find((link) => link.key === key)?.url ?? null;
}
