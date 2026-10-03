import '@kadro/brand/theme.css';
import '../components/marketing/fonts.css';
import './globals.css';

import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';

import {
  COLOR_SCHEME_META,
  THEME_COLOR,
  THEME_COOKIE,
  themePreferenceFromCookie,
} from '../components/marketing/theme';
import { ThemePreferenceProvider } from '../components/marketing/theme-context';

export const metadata: Metadata = {
  title: 'Kadro: Halı Saha & Eksik Oyuncu',
  description:
    'Kadro ile halı saha maçını organize et, eksik oyuncuyu mahallenden bul, saha ücretini takip et.',
  applicationName: 'Kadro',
};

export const viewport: Viewport = {
  colorScheme: COLOR_SCHEME_META,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
  ],
};

/**
 * The root layout sets no render mode (ADR-0021, ADR-0055). Each surface renders per request in
 * its own layout or page (`(app)/layout.tsx`, `page.tsx`, `not-found.tsx`) so Next.js can apply the
 * CSP nonce set by proxy.ts to its scripts (security checklist item 9); a prerendered page cannot
 * carry a per-request nonce, and `tests/built-server.test.ts` fails if any page is prerendered.
 *
 * Colour scheme (ADR-0084): it reads the `kadro-theme` cookie and renders
 * `<html data-theme="system|light|dark">` (`system` without a valid cookie), so the first paint
 * is in the right scheme with no inline script and the CSP unchanged. `@kadro/brand/theme.css`
 * maps the attribute to the colour roles; the footer toggle posts to `app/tema/route.ts`.
 */
export default async function RootLayout({ children }: { readonly children: ReactNode }) {
  const preference = themePreferenceFromCookie((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="tr" data-theme={preference}>
      <body>
        <ThemePreferenceProvider value={preference}>{children}</ThemePreferenceProvider>
      </body>
    </html>
  );
}
