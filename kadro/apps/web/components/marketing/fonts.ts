import './fonts.css';

/**
 * Brand font of the marketing and SEO surfaces (ADR-0084): Archivo, self-hosted WOFF2 from
 * `public/fonts` (copies of `@kadro/brand/fonts/archivo/web/*`), declared in `fonts.css` with
 * `font-display: swap`. `font-src 'self'` (security-headers.ts) covers them; there is no CDN. The
 * class on the shell sets the family.
 */
export const FONT_CLASS = 'kadroFonts';

/** The two subsets of `typography.fontFiles.web.subsets` (checked against the brand tokens). */
export const FONT_FILES: readonly string[] = [
  '/fonts/archivo-latin-wdth-wght.woff2',
  '/fonts/archivo-latin-ext-wdth-wght.woff2',
];

/**
 * Preloaded files: the latin subset only. It holds every glyph of Turkish copy, so the first
 * paint needs no other font file; the latin-ext face loads on demand.
 */
export const PRELOADED_FONTS: readonly string[] = ['/fonts/archivo-latin-wdth-wght.woff2'];
