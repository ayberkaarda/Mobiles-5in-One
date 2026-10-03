import { readdirSync, readFileSync, statSync } from 'node:fs';
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
import { FONT_FILES, PRELOADED_FONTS } from '../../components/marketing/fonts';
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
  brandColorVariable,
  COLOR_SCHEME_META,
  DEFAULT_THEME_PREFERENCE,
  MARKETING_NON_TEXT_PAIRS,
  MARKETING_TEXT_PAIRS,
  THEME_COLOR,
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE_DAYS,
  THEME_LABELS,
  THEME_PREFERENCES,
} from '../../components/marketing/theme';
import { surfaceFor } from '../../lib/server/security-headers';

/**
 * Marketing shell (ADR-0056, ADR-0084): brand tokens and contrast in both colour schemes, the
 * self-hosted Archivo files, navigation targets, metadata limits of product spec §7 and the
 * answer-first copy rule.
 */

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));
const BRAND_DIR = fileURLToPath(new URL('../../../../packages/brand/', import.meta.url));
const TOKENS_FILE = join(BRAND_DIR, 'theme', 'tokens.json');
const THEME_CSS_FILE = join(BRAND_DIR, 'theme', 'theme.css');
const PUBLIC_DIR = fileURLToPath(new URL('../../public/', import.meta.url));
const MARKETING_DIR = fileURLToPath(new URL('../../components/marketing/', import.meta.url));
const STYLESHEETS = ['marketing.module.css', 'primitives.module.css'] as const;

type Scheme = 'light' | 'dark';

interface ContrastPair {
  readonly scheme: Scheme | 'both';
  readonly foreground: string;
  readonly background: string;
}

interface BrandTokens {
  readonly color: { readonly theme: Readonly<Record<Scheme, Readonly<Record<string, string>>>> };
  readonly theming: {
    readonly preferences: readonly string[];
    readonly defaultPreference: string;
    readonly web: {
      readonly attribute: string;
      readonly cookie: string;
      readonly cookieMaxAgeDays: number;
      readonly metaColorScheme: string;
      readonly themeColor: Readonly<Record<Scheme, string>>;
    };
    readonly mobile: { readonly labels: Readonly<Record<string, string>> };
  };
  readonly typography: {
    readonly fontFiles: {
      readonly licenceFile: string;
      readonly web: {
        readonly fontStretch: string;
        readonly fontWeight: string;
        readonly payloadBudgetKB: number;
        readonly subsets: readonly {
          readonly file: string;
          readonly preload: boolean;
          readonly unicodeRange: string;
        }[];
      };
    };
  };
  readonly contrast: {
    readonly minimumRatio: number;
    readonly nonTextMinimumRatio: number;
    readonly pairs: readonly ContrastPair[];
    readonly nonTextPairs: readonly ContrastPair[];
  };
}

/** Code only: CSS comments removed so prose about a rule does not trip it. */
function readCss(path: string): string {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed paths in the repository
  return readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

/** True when the brand list checks `[foreground, background]` in `scheme`. */
function brandListHas(
  list: readonly ContrastPair[],
  [foreground, background]: readonly [string, string],
  scheme: Scheme,
): boolean {
  return list.some(
    (pair) =>
      pair.foreground === foreground &&
      pair.background === background &&
      (pair.scheme === 'both' || pair.scheme === scheme),
  );
}

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

describe('marketing theme (brand tokens v3, both schemes, WCAG 1.4.3 and 1.4.11)', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path in the repository
  const tokens = JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) as BrandTokens;
  const themeCss = readCss(THEME_CSS_FILE);
  const definedProperties = new Set(
    [...themeCss.matchAll(/(--k-[a-z0-9-]+)\s*:/g)].map((match) => match[1]),
  );
  const SCHEMES: readonly Scheme[] = ['light', 'dark'];

  it('mirrors theming of packages/brand/theme/tokens.json', () => {
    const { theming } = tokens;
    expect([...THEME_PREFERENCES]).toEqual(theming.preferences);
    expect(DEFAULT_THEME_PREFERENCE).toBe(theming.defaultPreference);
    expect(THEME_COOKIE).toBe(theming.web.cookie);
    expect(THEME_COOKIE_MAX_AGE_DAYS).toBe(theming.web.cookieMaxAgeDays);
    expect(COLOR_SCHEME_META).toBe(theming.web.metaColorScheme);
    expect(THEME_COLOR).toEqual(theming.web.themeColor);
    expect(THEME_LABELS).toEqual(theming.mobile.labels);
    expect(theming.web.attribute).toBe('data-theme');
    expect(tokens.contrast.minimumRatio).toBe(MIN_CONTRAST);
  });

  it('names a theme.css property for every colour role of both schemes', () => {
    for (const scheme of SCHEMES) {
      for (const role of Object.keys(tokens.color.theme[scheme])) {
        expect(definedProperties.has(brandColorVariable(role)), `${scheme} ${role}`).toBe(true);
      }
    }
    expect(brandColorVariable('surfaceSunken')).toBe('--k-color-surface-sunken');
  });

  it('renders only pairs of the brand contrast lists, and each passes in both schemes', () => {
    const lists = [
      [MARKETING_TEXT_PAIRS, tokens.contrast.pairs, tokens.contrast.minimumRatio],
      [MARKETING_NON_TEXT_PAIRS, tokens.contrast.nonTextPairs, tokens.contrast.nonTextMinimumRatio],
    ] as const;
    for (const [pairs, brandList, minimum] of lists) {
      expect(pairs.length).toBeGreaterThan(0);
      for (const scheme of SCHEMES) {
        const roles = tokens.color.theme[scheme];
        for (const pair of pairs) {
          const [foreground, background] = pair;
          const label = `${scheme}: ${foreground} on ${background}`;
          expect(brandListHas(brandList, pair, scheme), label).toBe(true);
          const ratio = contrastRatio(roles[foreground] ?? '', roles[background] ?? '');
          expect(ratio, label).toBeGreaterThanOrEqual(minimum);
        }
      }
    }
  });

  it('keeps every pair of the brand lists at its minimum in both schemes', () => {
    const lists = [
      [tokens.contrast.pairs, tokens.contrast.minimumRatio],
      [tokens.contrast.nonTextPairs, tokens.contrast.nonTextMinimumRatio],
    ] as const;
    for (const [list, minimum] of lists) {
      for (const pair of list) {
        const schemes = pair.scheme === 'both' ? SCHEMES : [pair.scheme];
        for (const scheme of schemes) {
          const roles = tokens.color.theme[scheme];
          const ratio = contrastRatio(roles[pair.foreground] ?? '', roles[pair.background] ?? '');
          const label = `${scheme}: ${pair.foreground} on ${pair.background}`;
          expect(ratio, label).toBeGreaterThanOrEqual(minimum);
        }
      }
    }
  });

  for (const sheet of STYLESHEETS) {
    describe(sheet, () => {
      const css = readCss(join(MARKETING_DIR, sheet));

      it('reads colours only from the brand properties, each defined by theme.css', () => {
        expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
        expect(css).not.toMatch(/\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/i);
        expect(css).not.toMatch(/:\s*(black|white)\b/i);
        expect(css).not.toMatch(/font-variation-settings/);
        const used = new Set(
          [...css.matchAll(/var\((--k-[a-z0-9-]+)\)/g)].map((match) => match[1] ?? ''),
        );
        expect(used.size).toBeGreaterThan(0);
        for (const property of used) {
          expect(definedProperties.has(property), property).toBe(true);
        }
        const colourDeclarations = css.matchAll(
          /(?:^|[\s;{])(?:color|background-color|border(?:-(?:top|right|bottom|left|color))?|fill|stroke|outline):[^;]*var\((--k-[a-z0-9-]+)\)/g,
        );
        for (const [, property] of colourDeclarations) {
          expect(property, property).toMatch(/^--k-(color|overlay)-/);
        }
      });

      it('keeps focus visible with the brand focus ring and honours reduced motion', () => {
        expect(css).toMatch(
          /:focus-visible[^{]*\{\s*outline: 2px solid var\(--k-color-focus-ring\);\s*outline-offset: 2px;/,
        );
        expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
      });
    });
  }

  it('gives every interactive element of the shell and the primitives a 44 px target', () => {
    const rules = [
      [
        'marketing.module.css',
        ['.navLink', '.headerCta', '.footerLink', '.skipLink', '.inlineLink', '.brand'],
      ],
      ['primitives.module.css', ['.button', '.textButton', '.themeOption']],
    ] as const;
    for (const [sheet, selectors] of rules) {
      const css = readCss(join(MARKETING_DIR, sheet));
      for (const selector of selectors) {
        const start = css.indexOf(`\n${selector} {`);
        expect(start, `${sheet} ${selector}`).toBeGreaterThanOrEqual(0);
        const body = css.slice(start, css.indexOf('}', start));
        const height = Number(/min-height: (\d+)px/.exec(body)?.[1] ?? 0);
        expect(height, `${sheet} ${selector}`).toBeGreaterThanOrEqual(44);
      }
    }
  });

  it('removes the outline only from the main landmark, which receives focus from the skip link', () => {
    const rules = STYLESHEETS.flatMap((sheet) =>
      [...readCss(join(MARKETING_DIR, sheet)).matchAll(/([^{}]+)\{[^}]*outline: none[^}]*\}/g)].map(
        (match) => match[1]?.trim(),
      ),
    );
    expect(rules).toEqual(['.main:focus']);
  });

  it('sets no colour and no inline style in the shell source', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path in the package
    const shell = readFileSync(join(MARKETING_DIR, 'marketing-shell.tsx'), 'utf8');
    expect(shell).not.toMatch(/style=\{|#[0-9a-f]{6}\b/i);
  });
});

describe('brand font files (ADR-0084)', () => {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path in the repository
  const tokens = JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) as BrandTokens;
  const { web } = tokens.typography.fontFiles;
  const css = readCss(join(MARKETING_DIR, 'fonts.css'));
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  const publicPath = (file: string) => `/fonts/${file.split('/').at(-1) ?? ''}`;

  it('serves the two Archivo subsets of the brand package, unchanged', () => {
    expect(FONT_FILES).toEqual(web.subsets.map((subset) => publicPath(subset.file)));
    for (const subset of web.subsets) {
      const served = join(PUBLIC_DIR, publicPath(subset.file));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths from the token file
      const same = readFileSync(served).equals(readFileSync(join(BRAND_DIR, subset.file)));
      expect(same, served).toBe(true);
    }
  });

  it('keeps public/fonts to the Archivo files within the payload budget', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed directory in the package
    const files = readdirSync(join(PUBLIC_DIR, 'fonts')).sort();
    expect(files).toEqual([
      'archivo-OFL.txt',
      'archivo-latin-ext-wdth-wght.woff2',
      'archivo-latin-wdth-wght.woff2',
    ]);
    const bytes = files
      .filter((file) => file.endsWith('.woff2'))
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- listed above
      .reduce((total, file) => total + statSync(join(PUBLIC_DIR, 'fonts', file)).size, 0);
    expect(bytes).toBeLessThanOrEqual(web.payloadBudgetKB * 1024);
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file in the package
    const served = readFileSync(join(PUBLIC_DIR, 'fonts', 'archivo-OFL.txt'), 'utf8');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- path from the token file
    const licence = readFileSync(join(BRAND_DIR, tokens.typography.fontFiles.licenceFile), 'utf8');
    expect(served).toBe(licence);
  });

  it('declares one swap face per subset with the axis ranges and unicode range of the tokens', () => {
    expect(faces).toHaveLength(web.subsets.length);
    for (const subset of web.subsets) {
      const face = faces.find((candidate) => candidate.includes(publicPath(subset.file)));
      expect(face, subset.file).toBeDefined();
      const text = (face ?? '').replace(/\s+/g, ' ');
      expect(text).toContain("font-family: 'Archivo';");
      expect(text).toContain(`font-weight: ${web.fontWeight};`);
      expect(text).toContain(`font-stretch: ${web.fontStretch};`);
      expect(text).toContain('font-display: swap;');
      expect(text).toContain(`unicode-range: ${subset.unicodeRange};`);
    }
    expect(css).not.toMatch(/https?:|Sora|Inter/);
  });

  it('preloads only the subsets the tokens mark for preloading', () => {
    expect(PRELOADED_FONTS).toEqual(
      web.subsets.filter((subset) => subset.preload).map((subset) => publicPath(subset.file)),
    );
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
