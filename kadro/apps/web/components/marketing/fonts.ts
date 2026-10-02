import localFont from 'next/font/local';

/**
 * Brand fonts (product spec §2: Sora for display, Inter for body), self-hosted from
 * `packages/brand/fonts` with `font-display: swap` (spec §7). `next/font` copies the files into
 * the build output, serves them from the same origin (`font-src 'self'`) and writes the
 * `@font-face` rules into the bundled stylesheet, so no inline style is needed (ADR-0055).
 *
 * Neither font is preloaded: text renders at once in the size-adjusted fallback that `next/font`
 * derives (it keeps the layout shift of the swap small) and changes face when the file arrives. Inter is an
 * 877 KB variable TrueType file; a subset WOFF2 is a follow-up measured by the Lighthouse budget
 * (ADR-0056).
 */

export const displayFont = localFont({
  src: '../../../../packages/brand/fonts/sora/Sora-VariableFont_wght.ttf',
  weight: '100 800',
  style: 'normal',
  display: 'swap',
  preload: false,
  variable: '--m-font-display',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const bodyFont = localFont({
  src: '../../../../packages/brand/fonts/inter/Inter-VariableFont.ttf',
  weight: '100 900',
  style: 'normal',
  display: 'swap',
  preload: false,
  variable: '--m-font-body',
  fallback: ['system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
});
