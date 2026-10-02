import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { contrastRatio, MIN_CONTRAST } from '../../lib/client/a11y';
import {
  FEATURE_SECTIONS,
  FEATURES_INTRO,
  FEATURES_META,
  HOME_INTRO,
  HOME_META,
} from '../../components/marketing/content';
import {
  DESCRIPTION_MAX,
  marketingLayoutMetadata,
  pageMetadata,
  renderedTitle,
  TITLE_MAX,
} from '../../components/marketing/metadata';
import {
  FOOTER_GROUPS,
  HEADER_LINKS,
  SITE_DESCRIPTION,
  SITE_TITLE,
  STORE_ENTRIES,
} from '../../components/marketing/site';
import {
  MARKETING_NON_TEXT_PAIRS,
  MARKETING_TEXT_PAIRS,
  MARKETING_THEME,
  marketingThemeVariables,
} from '../../components/marketing/theme';
import { surfaceFor } from '../../lib/server/security-headers';

/**
 * Marketing shell (ADR-0056): brand tokens and contrast, navigation targets, metadata limits of
 * product spec §7 and the answer-first copy rule.
 */

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));
const TOKENS_FILE = fileURLToPath(
  new URL('../../../../packages/brand/tokens.json', import.meta.url),
);
const CSS_FILE = fileURLToPath(
  new URL('../../components/marketing/marketing.module.css', import.meta.url),
);

/** URL paths of the static pages in `app/`: route groups removed, dynamic segments skipped. */
function staticPagePaths(): Set<string> {
  const paths = new Set<string>();
  const walk = (relative: readonly string[]) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks this package's app dir
    for (const entry of readdirSync(join(APP_DIR, ...relative), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('[') && entry.name !== 'api') {
          walk([...relative, entry.name]);
        }
      } else if (entry.name === 'page.tsx') {
        const segments = relative.filter((segment) => !/^\(.+\)$/.test(segment));
        paths.add(`/${segments.join('/')}`);
      }
    }
  };
  walk([]);
  return paths;
}

function words(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

describe('marketing theme (brand tokens, WCAG 1.4.3 and 1.4.11)', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path in the repo
  const tokens = JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) as {
    color: { theme: { light: Record<string, string> } };
    contrast: { minimumRatio: number };
  };

  it('uses the light theme of packages/brand/tokens.json', () => {
    for (const [name, value] of Object.entries(MARKETING_THEME)) {
      expect(tokens.color.theme.light[name], name).toBe(value);
    }
    expect(tokens.contrast.minimumRatio).toBe(MIN_CONTRAST);
  });

  it('meets 4.5:1 for every text pair and 3:1 for every non-text pair', () => {
    for (const [foreground, background] of MARKETING_TEXT_PAIRS) {
      const ratio = contrastRatio(MARKETING_THEME[foreground], MARKETING_THEME[background]);
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(MIN_CONTRAST);
    }
    for (const [foreground, background] of MARKETING_NON_TEXT_PAIRS) {
      const ratio = contrastRatio(MARKETING_THEME[foreground], MARKETING_THEME[background]);
      expect(ratio, `${foreground} on ${background}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('exposes every color as a --m-* custom property', () => {
    expect(marketingThemeVariables()).toMatchObject({
      '--m-text': MARKETING_THEME.text,
      '--m-accent': MARKETING_THEME.accent,
    });
  });

  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path in the package
  const css = readFileSync(CSS_FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

  it('reads colors only from the theme properties (overlays are color-mix of a property)', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(css).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i);
    expect(css).not.toMatch(/:\s*(black|white)\b/i);
    const mixes = css.split('color-mix(').length - 1;
    const tokenMixes = [
      ...css.matchAll(/color-mix\(in srgb, var\(--m-[a-zA-Z]+\) \d{1,2}%, transparent\)/g),
    ].length;
    expect(mixes).toBeGreaterThan(0);
    expect(tokenMixes).toBe(mixes);
    const used = new Set([...css.matchAll(/var\(--m-([a-zA-Z]+)\)/g)].map((match) => match[1]));
    for (const name of used) {
      if (name !== undefined && !name.startsWith('font')) {
        expect(Object.keys(MARKETING_THEME), name).toContain(name);
      }
    }
  });

  it('keeps focus visible, targets at least 44 px and honours reduced motion', () => {
    expect(css).toMatch(/:focus-visible[\s\S]*outline: 3px solid/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    for (const rule of ['.navLink', '.headerCta', '.footerLink', '.skipLink', '.inlineLink']) {
      const start = css.indexOf(`\n${rule} {`);
      expect(start, rule).toBeGreaterThanOrEqual(0);
      const body = css.slice(start, css.indexOf('}', start));
      expect(body, rule).toMatch(/min-height: 44px/);
    }
  });

  it('removes the outline only from the main landmark, which receives focus from the skip link', () => {
    const rules = [...css.matchAll(/([^{}]+)\{[^}]*outline: none[^}]*\}/g)].map((match) =>
      match[1]?.trim(),
    );
    expect(rules).toEqual(['.main:focus']);
  });
});

describe('marketing navigation', () => {
  const pages = staticPagePaths();

  it('finds the marketing pages in app/', () => {
    expect([...pages]).toEqual(expect.arrayContaining(['/', '/ozellikler', '/hesap-silme']));
  });

  it('links only to pages that exist', () => {
    const links = [...HEADER_LINKS, ...FOOTER_GROUPS.flatMap((group) => group.links)];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(pages.has(link.href), link.href).toBe(true);
    }
  });

  it('serves every marketing page from the marketing surface (nonce CSP, indexable)', () => {
    for (const path of ['/', '/ozellikler']) {
      expect(surfaceFor(path).name, path).toBe('marketing');
    }
  });

  it('links to no store listing until one exists', () => {
    expect(STORE_ENTRIES.map((entry) => entry.store)).toEqual(['appStore', 'googlePlay']);
    for (const entry of STORE_ENTRIES) {
      expect(entry.href, entry.store).toBeNull();
    }
  });
});

describe('marketing metadata (product spec §7)', () => {
  it('sets the metadata base, title template and Open Graph defaults from the web origin', () => {
    const metadata = marketingLayoutMetadata('https://kadro.app');
    expect(String(metadata.metadataBase)).toBe('https://kadro.app/');
    expect(metadata.title).toEqual({ default: SITE_TITLE, template: '%s · Kadro' });
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'Kadro',
      locale: 'tr_TR',
    });
    expect(metadata.alternates).toBeUndefined();
  });

  it('gives every page its own canonical path and hreflang', () => {
    const metadata = pageMetadata({ title: 'Özellikler', description: 'x', path: '/ozellikler' });
    expect(metadata.alternates).toEqual({
      canonical: '/ozellikler',
      languages: { 'tr-TR': '/ozellikler', 'x-default': '/ozellikler' },
    });
    expect(metadata.openGraph).toMatchObject({
      url: '/ozellikler',
      title: 'Özellikler · Kadro',
      locale: 'tr_TR',
    });
    expect(pageMetadata({ title: null, description: 'x', path: '/' }).title).toEqual({
      absolute: SITE_TITLE,
    });
  });

  it('keeps titles within 60 and descriptions within 155 characters', () => {
    const pagesMeta = [
      { title: null, description: HOME_META.description },
      { title: FEATURES_META.title, description: FEATURES_META.description },
      { title: null, description: SITE_DESCRIPTION },
    ];
    for (const { title, description } of pagesMeta) {
      expect(renderedTitle(title).length, renderedTitle(title)).toBeLessThanOrEqual(TITLE_MAX);
      expect(description.length, description).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });
});

describe('marketing copy (product spec §7 GEO)', () => {
  it('opens every page with a 40 to 60 word answer-first paragraph that names Kadro', () => {
    for (const intro of [HOME_INTRO, FEATURES_INTRO]) {
      expect(intro.startsWith('Kadro, ')).toBe(true);
      expect(words(intro), intro).toBeGreaterThanOrEqual(40);
      expect(words(intro), intro).toBeLessThanOrEqual(60);
    }
  });

  it('describes every feature section with text and at least one point', () => {
    const ids = FEATURE_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of FEATURE_SECTIONS) {
      expect(section.id).toMatch(/^[a-z-]+$/);
      expect(section.text.length, section.id).toBeGreaterThan(20);
      expect(section.points.length, section.id).toBeGreaterThan(0);
    }
  });

  it('states no price: Kadro Pro prices are set in the stores', () => {
    const copy = JSON.stringify(FEATURE_SECTIONS) + HOME_INTRO + FEATURES_INTRO;
    expect(copy).not.toMatch(/₺|\bTL\b|\$|€|\d+[.,]\d{2}\b/);
  });
});
