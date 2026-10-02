import type { Metadata } from 'next';

/**
 * Metadata of the email-link pages (ADR-0040): never indexed or followed, and the two token
 * pages also carry `<meta name="referrer" content="no-referrer">` next to the response header
 * set by the proxy, so no navigation or request from them sends a `Referer`.
 */
export function emailLinkMetadata(
  title: string,
  options: { readonly tokenPage: boolean },
): Metadata {
  return {
    title: `${title} · Kadro`,
    robots: { index: false, follow: false },
    ...(options.tokenPage ? { referrer: 'no-referrer' as const } : {}),
  };
}
