import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminPage } from '../../components/admin/frames';
import type * as JsonLdModule from '../../components/seo/json-ld';
import { Breadcrumb } from '../../components/seo/breadcrumb';
import { avatarInitial } from '../../components/seo/format';

/**
 * Restyled SEO pages: the avatar initial, the breadcrumb list, the venue and district markup with
 * fixture data (no database), and the stylesheet rules (brand properties only, hairlines, targets).
 */

const data = vi.hoisted(() => ({ venue: null as unknown, listing: null as unknown }));

vi.mock('@kadro/config', () => ({ loadWebEnv: () => ({ WEB_ORIGIN: 'https://kadro.example' }) }));
vi.mock('../../components/seo/json-ld', async () => {
  const actual = await vi.importActual<typeof JsonLdModule>('../../components/seo/json-ld');
  return { ...actual, JsonLd: actual.JsonLdScript };
});
vi.mock('../../lib/server/seo/data', () => ({
  publicVenue: () => Promise.resolve(data.venue),
  districtListing: () => Promise.resolve(data.listing),
}));

const { default: VenuePage } = await import('../../app/(seo)/saha/[slug]/page');
const { default: DistrictPage } = await import('../../app/(seo)/eksik-var/[il]/[ilce]/page');

const district = { id: 'd1', il: 'İstanbul', ilce: 'Kadıköy', ilSlug: 'istanbul', slug: 'kadikoy' };

const venue = {
  id: 'v1',
  name: '[ÖRNEK] Deneme Kapalı Saha',
  slug: 'deneme-kapali-saha',
  indoor: true,
  isSample: true,
  address: null,
  phone: null,
  priceMinMinor: 200000,
  priceMaxMinor: 300000,
  features: { lighting: true, shower: false },
  rating: { average: 4.5, count: 6 },
  recentReviews: [
    {
      id: 'r1',
      authorDisplayName: '[ÖRNEK] Deneme Oyuncu',
      rating: 5,
      text: 'Zemin iyi.',
      createdAt: '2026-09-01T10:00:00.000Z',
    },
  ],
  district,
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const call = {
  id: 'c1',
  missingCount: 2,
  format: '7v7',
  startsAt: '2026-10-10T17:00:00.000Z',
  expiresAt: '2026-10-10T15:00:00.000Z',
  position: 'GK',
  level: 'regular',
  teamName: 'Deneme Takım',
  venue: { name: 'Deneme Saha', slug: 'deneme-saha' },
};

function read(url: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed paths in the repository
  return readFileSync(fileURLToPath(new URL(url, import.meta.url)), 'utf8');
}

const CSS = read('../../components/seo/seo.module.css');
const THEME_CSS = read('../../../../packages/brand/theme/theme.css');

beforeEach(() => {
  data.venue = venue;
  data.listing = {
    district,
    calls: [call],
    venues: [{ name: 'Deneme Saha', slug: 'deneme-saha', isSample: true }],
  };
});

describe('avatarInitial', () => {
  it('drops a leading bracket tag before taking the initial', () => {
    expect(avatarInitial('[ÖRNEK] Deneme Oyuncu')).toBe('D');
    expect(avatarInitial('  [ÖRNEK]   ilker')).toBe('İ');
    expect(avatarInitial('Ayşe')).toBe('A');
  });

  it('falls back for an empty name or a tag only', () => {
    expect(avatarInitial('')).toBe('?');
    expect(avatarInitial('[ÖRNEK]')).toBe('?');
  });
});

describe('breadcrumb', () => {
  it('is a semantic ordered list with the current page marked', () => {
    const html = renderToStaticMarkup(<Breadcrumb current="Deneme" />);
    expect(html).toMatch(/<nav aria-label="Konum"><ol class="[^"]*crumbs[^"]*">/);
    expect(html).toContain('aria-current="page">Deneme</li>');
  });

  it('draws no list numbers', () => {
    const block = /\.crumbs \{[^}]*\}/.exec(CSS)?.[0] ?? '';
    expect(block).toContain('list-style: none');
  });
});

describe('venue page', () => {
  it('renders the avatar without the bracket tag, the sample tag and the facts', async () => {
    const html = renderToStaticMarkup(
      await VenuePage({ params: Promise.resolve({ slug: venue.slug }) }),
    );
    expect(html).toMatch(/aria-hidden="true">D<\/span>/);
    expect(html).not.toContain('>[D<');
    expect(html).toContain('<h1');
    expect(html).toContain('[ÖRNEK] Deneme Kapalı Saha');
    expect(html).toContain('Bu kayıt örnek veridir; gerçek bir halı saha değildir.');
    expect(html).toContain('<dl');
    expect(html).toContain('Aydınlatma: Var');
    expect(html).toContain('Duş: Yok');
    expect(html).toContain('application/ld+json');
    expect(html).toContain('Bu sahada maç kur');
  });
});

describe('district page', () => {
  it('renders open calls as rows with the outlined eksik slot', async () => {
    const html = renderToStaticMarkup(
      await DistrictPage({ params: Promise.resolve({ il: 'istanbul', ilce: 'kadikoy' }) }),
    );
    expect(html).toContain('2 eksik oyuncu');
    expect(html).toContain('aria-label="2 eksik oyuncu"');
    expect(html).toContain('Mevki: Kaleci');
    expect(html).toContain('href="/saha/deneme-saha"');
    expect(html).toContain('<ol');
    expect(html).toContain('application/ld+json');
  });

  it('keeps the empty message when no call is open', async () => {
    data.listing = { district, calls: [], venues: [] };
    const html = renderToStaticMarkup(
      await DistrictPage({ params: Promise.resolve({ il: 'istanbul', ilce: 'kadikoy' }) }),
    );
    expect(html).toContain('açık eksik oyuncu ilanı yok');
  });
});

describe('seo stylesheet', () => {
  it('uses only brand properties and no literal colours or font names', () => {
    expect(CSS.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(CSS).not.toMatch(/rgb\(|rgba\(|hsl\(|font-family:\s*(?!var\()/);
    for (const [, property] of CSS.matchAll(/var\((--k-[a-z0-9-]+)\)/g)) {
      expect(THEME_CSS, property).toContain(`${property ?? ''}:`);
    }
  });

  it('keeps 44 px link targets and a visible focus ring', () => {
    expect(CSS).toMatch(/\.crumbs a \{[^}]*min-height: 44px/);
    expect(CSS).toMatch(/\.textLink \{[^}]*min-height: 44px/);
    expect(CSS).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--k-color-focus-ring\)/);
    expect(CSS).not.toMatch(/outline:\s*(none|0)/);
  });
});

describe('admin frame', () => {
  it('stays in the light scheme whatever the visitor scheme is', () => {
    const html = renderToStaticMarkup(
      <AdminPage>
        <p>x</p>
      </AdminPage>,
    );
    expect(html).toMatch(/^<div class="[^"]*" data-theme="light"/);
  });
});
