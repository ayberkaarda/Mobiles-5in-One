import './fonts.css';

/**
 * Brand fonts of the marketing and SEO surfaces (ADR-0059): Sora for display, Inter for body,
 * self-hosted WOFF2 from `public/fonts`, declared in `fonts.css` with `font-display: swap`.
 * `font-src 'self'` (security-headers.ts) covers them; there is no CDN. The class on the shell
 * sets `--m-font-display` and `--m-font-body`.
 */
export const FONT_CLASS = 'kadroFonts';

/**
 * Files of the latin subsets, preloaded. The latin-ext faces (Turkish letters) are not: preloading
 * them as well was measured and did not move the largest contentful paint, so they load on demand.
 */
export const PRELOADED_FONTS: readonly string[] = [
  '/fonts/inter-latin-wght-normal.woff2',
  '/fonts/sora-latin-wght-normal.woff2',
];
