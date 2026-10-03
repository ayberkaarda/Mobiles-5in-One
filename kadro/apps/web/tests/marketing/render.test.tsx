import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Server render of the marketing shell and pages (ADR-0056): landmarks, skip link, heading
 * order, current-page marker, store entries without guessed links, and the generic error view.
 * the font module (a CSS import) is replaced by its class name.
 */

const navigation = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

vi.mock('../../components/marketing/fonts', () => ({
  FONT_CLASS: 'font-class',
  PRELOADED_FONTS: ['/fonts/test.woff2'],
}));

vi.mock('../../components/seo/site-json-ld', () => ({ SiteJsonLd: () => null }));

const { MarketingShell, MAIN_ID } = await import('../../components/marketing/marketing-shell');
const { StoreBadges } = await import('../../components/marketing/store-badges');
const { STORE_ENTRIES } = await import('../../components/marketing/site');
const { default: HomePage } = await import('../../app/(marketing)/page');
const { default: FeaturesPage } = await import('../../app/(marketing)/ozellikler/page');
const { default: MarketingError } = await import('../../app/(marketing)/error');

function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
}

/** Headings never skip a level downwards (h1 → h3 without h2). */
function expectHeadingOrder(html: string): void {
  const levels = headingLevels(html);
  expect(levels[0]).toBe(1);
  for (let index = 1; index < levels.length; index += 1) {
    const previous = levels[index - 1] ?? 1;
    const current = levels[index] ?? 1;
    expect(current, levels.join(',')).toBeLessThanOrEqual(previous + 1);
  }
}

/** External hrefs (`http:`, `https:`, `//`) in the markup. */
function externalHrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)]
    .map((match) => match[1] ?? '')
    .filter((href) => /^(https?:|\/\/)/i.test(href));
}

/** The store listings: the only external links the marketing pages may render. */
const STORE_HREFS: readonly string[] = STORE_ENTRIES.flatMap((entry) =>
  entry.href === null ? [] : [entry.href],
);

function expectSafeMarkup(html: string, allowedExternal: readonly string[] = STORE_HREFS): void {
  expect(html).not.toMatch(/<script\b/);
  expect(html).not.toMatch(/\son[a-z]+="/);
  expect(html).not.toMatch(/<style\b/);
  for (const href of externalHrefs(html)) {
    expect(allowedExternal, href).toContain(href);
  }
}

beforeEach(() => {
  navigation.pathname = '/';
});

describe('marketing shell', () => {
  it('renders the skip link first, then header, one main and footer landmarks', () => {
    const html = render(
      <MarketingShell>
        <h1>Başlık</h1>
      </MarketingShell>,
    );
    const firstLink = /<a\b[^>]*>/.exec(html)?.[0] ?? '';
    expect(firstLink).toContain(`href="#${MAIN_ID}"`);
    expect(html).toContain('İçeriğe geç');
    expect(count(html, /<header\b/g)).toBe(1);
    expect(count(html, /<main\b/g)).toBe(1);
    expect(count(html, /<footer\b/g)).toBe(1);
    expect(html).toContain(`<main id="${MAIN_ID}" tabindex="-1"`);
    expect(html).toContain('<nav aria-label="Ana menü"');
    expect(html).toContain('<nav aria-label="Alt menü"');
    expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main'));
    expect(html.indexOf('<main')).toBeLessThan(html.indexOf('<footer'));
    expect(html).toContain('aria-label="Kadro ana sayfa"');
    expect(html).toContain('© Kadro. Kadro bir portfolyo projesidir.');
    expect(html).not.toContain('Teknoloji');
    expect(html).toContain('font-class');
    expect(html).toContain('--m-primary:#1B7F4B');
    expectSafeMarkup(html);
  });

  it('marks the current page in both navigations', () => {
    navigation.pathname = '/ozellikler';
    const html = render(
      <MarketingShell>
        <h1>Başlık</h1>
      </MarketingShell>,
    );
    const current = [...html.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)].map(
      (match) => /href="([^"]+)"/.exec(match[0])?.[1],
    );
    expect(current).toEqual(['/ozellikler', '/ozellikler']);
  });

  it('renders store entries without a listing as text, never as links', () => {
    const html = render(<StoreBadges />);
    expect(html).not.toContain('<a');
    expect(count(html, /Yakında/g)).toBe(2);
    expect(html).toContain('App Store');
    expect(html).toContain('Google Play');
  });

  it('links a store entry once it has a listing', () => {
    const html = render(
      <StoreBadges
        entries={[{ store: 'googlePlay', label: 'Google Play', href: '/magaza-ornegi' }]}
      />,
    );
    expect(html).toContain('href="/magaza-ornegi"');
    expect(html).toContain('rel="noopener"');
  });

  it('accepts an external link only when it is an allowed store listing', () => {
    const listing = 'https://store.example/kadro';
    const html = render(
      <StoreBadges entries={[{ store: 'appStore', label: 'App Store', href: listing }]} />,
    );
    expect(externalHrefs(html)).toEqual([listing]);
    expectSafeMarkup(html, [listing]);
    expect(() => {
      expectSafeMarkup(html);
    }).toThrow();
    expect(() => {
      expectSafeMarkup(`${html}<a href="//other.example/x">x</a>`, [listing]);
    }).toThrow();
  });
});

describe('marketing pages', () => {
  it('home page: one h1, ordered headings, download section and no inline script', () => {
    const html = render(<HomePage />);
    expect(count(html, /<h1\b/g)).toBe(1);
    expect(html).toContain('Kadron eksik kalmasın.');
    expect(html).toContain('id="indir"');
    expect(html).toContain('href="#indir"');
    expect(html).toContain('href="/ozellikler"');
    for (const [, id] of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expectHeadingOrder(html);
    expectSafeMarkup(html);
  });

  it('features page: one h1, a labelled section per feature, the price note', () => {
    const html = render(<FeaturesPage />);
    expect(count(html, /<h1\b/g)).toBe(1);
    expect(count(html, /<article\b/g)).toBe(1);
    for (const [, id] of html.matchAll(/aria-labelledby="([^"]+)"/g)) {
      expect(html, id).toContain(`id="${id}"`);
    }
    expect(html).toContain('id="kadro-pro"');
    expect(html).toContain('Kadro Pro fiyatları uygulama mağazalarında belirlenir.');
    expectHeadingOrder(html);
    expectSafeMarkup(html);
  });

  it('error view shows a fixed message and the digest only', () => {
    const leaky = Object.assign(new Error('relation "users" does not exist at /srv/app.tsx'), {
      digest: '2734198412',
    });
    const html = render(<MarketingError error={leaky} retry={() => undefined} />);
    expect(html).toContain('Bir şeyler ters gitti');
    expect(html).toContain('Referans: 2734198412');
    for (const leak of ['relation', 'users', '/srv/', 'does not exist']) {
      expect(html).not.toContain(leak);
    }
    const withoutDigest = render(
      <MarketingError error={new Error('stack detail')} retry={() => undefined} />,
    );
    expect(withoutDigest).not.toContain('stack detail');
    expect(withoutDigest).not.toContain('Referans');
  });
});
