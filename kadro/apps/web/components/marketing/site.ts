import type { Route } from 'next';

/**
 * Site facts and navigation of the marketing shell (ADR-0056). Product copy is Turkish first
 * (product spec §2). Every link target is a page that exists today: `typedRoutes` rejects an
 * unknown path at type-check time and `tests/marketing/site.test.ts` checks each one against the
 * `app/` tree. Pages delivered by later work (legal pages, blog, FAQ, about, contact, venue and
 * open-call listings) add their entries here together with the page.
 */

export const SITE_NAME = 'Kadro';
export const SITE_TITLE = 'Kadro: Halı Saha & Eksik Oyuncu';
export const SITE_TAGLINE = 'Kadron eksik kalmasın.';
export const SITE_DESCRIPTION =
  'Kadro ile halı saha maçını organize et, eksik oyuncuyu mahallenden bul, saha ücretini takip et.';
export const SITE_LOCALE = 'tr_TR';
export const LEGAL_NAME = 'Kadro Teknoloji';
export const PORTFOLIO_NOTE = 'Kadro bir portfolyo projesidir.';

export interface SiteLink {
  readonly href: Route;
  readonly label: string;
}

export interface FooterGroup {
  readonly title: string;
  readonly links: readonly SiteLink[];
}

/** Header navigation (`nav` landmark "Ana menü"). */
export const HEADER_LINKS: readonly SiteLink[] = [
  { href: '/', label: 'Ana sayfa' },
  { href: '/ozellikler', label: 'Özellikler' },
];

/** Footer navigation (`nav` landmark "Alt menü"). */
export const FOOTER_GROUPS: readonly FooterGroup[] = [
  {
    title: 'Ürün',
    links: [
      { href: '/', label: 'Ana sayfa' },
      { href: '/ozellikler', label: 'Özellikler' },
    ],
  },
  {
    title: 'Hesap',
    links: [{ href: '/hesap-silme', label: 'Hesabımı sil' }],
  },
];

/** Section of the home page that holds the store entries; the header button points to it. */
export const DOWNLOAD_ANCHOR = 'indir';

export type StoreName = 'appStore' | 'googlePlay';

export interface StoreEntry {
  readonly store: StoreName;
  readonly label: string;
  /** The store listing, or `null` while the app is not published there. */
  readonly href: string | null;
}

/**
 * App store entries. The app is not published yet, so no listing exists and each entry renders
 * as a plain "coming soon" label instead of a link. When the listings exist, the hrefs come from
 * configuration (the Apple App Store id and the Android application id `app.kadro.mobile`), never
 * from a hand-written URL in this file.
 */
export const STORE_ENTRIES: readonly StoreEntry[] = [
  { store: 'appStore', label: 'App Store', href: null },
  { store: 'googlePlay', label: 'Google Play', href: null },
];
