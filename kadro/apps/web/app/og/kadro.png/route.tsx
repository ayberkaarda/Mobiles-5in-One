import { renderOgImage } from '../../../components/marketing/og-image';
import { SITE_TAGLINE } from '../../../components/marketing/site';

/**
 * Site card image `/og/kadro.png` (ADR-0083): the Open Graph and Twitter image of every public
 * page without an image of its own. Rendered once by `next build`; the PNG carries no script, so
 * the per-request nonce of the HTML surfaces (ADR-0055) does not apply to it.
 */
export const dynamic = 'force-static';

export function GET(): Promise<Response> {
  return renderOgImage({
    eyebrow: null,
    title: SITE_TAGLINE,
    subtitle: 'Halı saha maçını organize et, eksik oyuncuyu bul, saha ücretini takip et.',
  });
}
