import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { FAQ_ENTRIES, FAQ_INTRO, FAQ_META, FAQ_NOTE_TEXT } from '../../components/content/faq';
import {
  DESCRIPTION_MAX,
  marketingLayoutMetadata,
  pageMetadata,
  renderedTitle,
  TITLE_MAX,
} from '../../components/marketing/metadata';
import {
  articleOgImage,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  SITE_OG_IMAGE,
} from '../../components/marketing/og';
import {
  OG_CACHE_CONTROL,
  OG_FONT_FILES,
  OG_PALETTE,
  OG_WORDMARK_FILE,
} from '../../components/marketing/og-image';
import { serializeJsonLd } from '../../components/seo/json-ld';
import { findDocument, loadCollection } from '../../lib/content/documents';
import { surfaceFor } from '../../lib/server/security-headers';
import {
  articleStructuredData,
  faqStructuredData,
} from '../../lib/server/seo/site-structured-data';

/**
 * FAQ page and card images (ADR-0083) without a build: the FAQ copy and its `FAQPage` mirror,
 * the card metadata of `pageMetadata`, the brand inputs of the card renderer, the surfaces of the
 * new paths and the route lists of the llms files.
 */

const WEB_DIR = fileURLToPath(new URL('../../', import.meta.url));
const APP_DIR = join(WEB_DIR, 'app');
const TOKENS_FILE = fileURLToPath(
  new URL('../../../../packages/brand/tokens.json', import.meta.url),
);
const ORIGIN = 'https://kadro.example';

function words(text: string): number {
  return text.split(/\s+/).filter((word) => word !== '').length;
}

/** URL patterns of every page and route handler in `app/`: groups removed, `[x]` kept. */
function routePatterns(): Set<string> {
  const patterns = new Set<string>();
  const walk = (relative: readonly string[]) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks this package's app dir
    for (const entry of readdirSync(join(APP_DIR, ...relative), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk([...relative, entry.name]);
      } else if (/^(page|route)\.tsx?$/.test(entry.name)) {
        const segments = relative.filter((segment) => !/^\(.+\)$/.test(segment));
        patterns.add(`/${segments.join('/')}`);
      }
    }
  };
  walk([]);
  return patterns;
}

/** Table tags of a TrueType file (offset table and table records). */
function tableTags(file: Buffer): string[] {
  const count = file.readUInt16BE(4);
  return Array.from({ length: count }, (_, index) =>
    file.toString('latin1', 12 + index * 16, 16 + index * 16),
  );
}

describe('FAQ copy (product spec §7 GEO)', () => {
  it('holds 8 to 12 questions with unique anchors and non-empty answers', () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(8);
    expect(FAQ_ENTRIES.length).toBeLessThanOrEqual(12);
    const ids = FAQ_ENTRIES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of FAQ_ENTRIES) {
      expect(entry.id).toMatch(/^[a-z][a-z-]*[a-z]$/);
      expect(entry.question.endsWith('?'), entry.question).toBe(true);
      expect(words(entry.answer), entry.id).toBeGreaterThanOrEqual(15);
    }
  });

  it('opens with a 40 to 60 word answer-first paragraph that names Kadro', () => {
    expect(FAQ_INTRO.startsWith('Kadro, ')).toBe(true);
    expect(words(FAQ_INTRO)).toBeGreaterThanOrEqual(40);
    expect(words(FAQ_INTRO)).toBeLessThanOrEqual(60);
  });

  it('keeps the title within 60 and the description within 155 characters', () => {
    expect(renderedTitle(FAQ_META.title).length).toBeLessThanOrEqual(TITLE_MAX);
    expect(FAQ_META.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it('states no price and says what is a sample', () => {
    const copy = JSON.stringify(FAQ_ENTRIES) + FAQ_INTRO + FAQ_NOTE_TEXT;
    expect(copy).not.toMatch(/₺|\bTL\b|\$|€|\d+[.,]\d{2}\b/);
    expect(FAQ_NOTE_TEXT).toContain('Kadro bir portfolyo projesidir.');
    expect(FAQ_NOTE_TEXT).toMatch(/fiyat belirlenmemiştir/);
    expect(FAQ_NOTE_TEXT).toMatch(/örnek metindir/);
  });
});

describe('FAQPage structured data', () => {
  const data = faqStructuredData(ORIGIN, '/sss', FAQ_META.title, FAQ_ENTRIES);
  const graph = data['@graph'] as readonly Record<string, unknown>[];

  it('builds BreadcrumbList, FAQPage and Organization with absolute URLs', () => {
    expect(data['@context']).toBe('https://schema.org');
    expect(graph.map((node) => node['@type'])).toEqual([
      'BreadcrumbList',
      'FAQPage',
      'Organization',
    ]);
    expect(graph[1]).toMatchObject({ url: `${ORIGIN}/sss`, inLanguage: 'tr-TR' });
    const crumbs = graph[0]?.itemListElement as readonly Record<string, unknown>[];
    expect(crumbs.map((crumb) => crumb.item)).toEqual([`${ORIGIN}/`, `${ORIGIN}/sss`]);
  });

  it('mirrors every question and answer of the page, in order', () => {
    const questions = graph[1]?.mainEntity as readonly Record<string, unknown>[];
    expect(questions).toHaveLength(FAQ_ENTRIES.length);
    questions.forEach((question, index) => {
      const entry = FAQ_ENTRIES[index];
      expect(question).toEqual({
        '@type': 'Question',
        name: entry?.question,
        acceptedAnswer: { '@type': 'Answer', text: entry?.answer },
      });
    });
  });

  it('keeps hostile text as data: escaped in the serialized block, intact after parsing', () => {
    const hostile = '</script><script>alert(1)</script> & <!--';
    const serialized = serializeJsonLd(
      faqStructuredData(ORIGIN, '/sss', FAQ_META.title, [{ question: hostile, answer: hostile }]),
    );
    expect(serialized).not.toMatch(/[<>&]/);
    const parsed = JSON.parse(serialized) as { '@graph': Record<string, unknown>[] };
    const [question] = parsed['@graph'][1]?.mainEntity as Record<string, unknown>[];
    expect(question?.name).toBe(hostile);
  });
});

describe('card image metadata (ADR-0083)', () => {
  it('gives every page the site card as Open Graph image and a large Twitter card', () => {
    const metadata = pageMetadata({ title: 'Özellikler', description: 'x', path: '/ozellikler' });
    expect(metadata.openGraph?.images).toEqual([
      {
        url: SITE_OG_IMAGE.path,
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
        alt: SITE_OG_IMAGE.alt,
        type: 'image/png',
      },
    ]);
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: 'Özellikler · Kadro',
      images: [{ url: SITE_OG_IMAGE.path, alt: SITE_OG_IMAGE.alt }],
    });
    expect(marketingLayoutMetadata(ORIGIN).twitter).toMatchObject({
      card: 'summary_large_image',
    });
  });

  it('uses the article card when a page passes one', () => {
    const image = articleOgImage('kadro-nasil-kurulur', 'Kadro nasıl kurulur');
    expect(image.path).toBe('/og/blog/kadro-nasil-kurulur');
    const metadata = pageMetadata({
      title: 'Kadro nasıl kurulur',
      description: 'x',
      path: '/blog/kadro-nasil-kurulur',
      image,
    });
    expect(metadata.openGraph?.images).toMatchObject([{ url: image.path }]);
    expect(metadata.twitter).toMatchObject({ images: [{ url: image.path }] });
  });

  it('gives the Article node the card image as an absolute URL', () => {
    const article = findDocument('blog', 'kadro-nasil-kurulur');
    expect(article).toBeDefined();
    if (article === undefined) {
      return;
    }
    const path = `/blog/${article.slug}`;
    const graph = articleStructuredData(
      ORIGIN,
      article,
      path,
      articleOgImage(article.slug, article.title).path,
    )['@graph'] as readonly Record<string, unknown>[];
    expect(graph[1]?.image).toBe(`${ORIGIN}/og/blog/${article.slug}`);
    const without = articleStructuredData(ORIGIN, article, path)['@graph'] as readonly Record<
      string,
      unknown
    >[];
    expect(without[1]).not.toHaveProperty('image');
  });

  it('has an image route for the site card and one per article', () => {
    const patterns = routePatterns();
    expect(patterns.has(SITE_OG_IMAGE.path)).toBe(true);
    expect(patterns.has('/og/blog/[slug]')).toBe(true);
    expect(loadCollection('blog').length).toBeGreaterThan(0);
  });
});

describe('card image renderer inputs', () => {
  it('uses the palette of packages/brand/tokens.json', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path in the repo
    const tokens = JSON.parse(readFileSync(TOKENS_FILE, 'utf8')) as {
      color: { palette: Record<string, string> };
    };
    for (const [name, value] of Object.entries(OG_PALETTE)) {
      expect(tokens.color.palette[name], name).toBe(value);
    }
  });

  it('reads static font instances and the brand wordmark from the repository', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed brand file name
    expect(existsSync(join(WEB_DIR, OG_WORDMARK_FILE))).toBe(true);
    for (const name of Object.values(OG_FONT_FILES)) {
      const relative = join('assets', 'og-fonts', name);
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- names in OG_FONT_FILES
      const tags = tableTags(readFileSync(join(WEB_DIR, relative)));
      // A variable font (fvar/gvar) makes the renderer fail; the instances are static.
      expect(tags, relative).toEqual(expect.arrayContaining(['glyf', 'cmap', 'name']));
      expect(tags, relative).not.toContain('fvar');
      expect(tags, relative).not.toContain('gvar');
    }
    for (const licence of ['sora-OFL.txt', 'inter-OFL.txt']) {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed licence names
      expect(existsSync(join(WEB_DIR, 'assets', 'og-fonts', licence)), licence).toBe(true);
    }
  });

  it('marks the cards cacheable by shared caches, not immutable', () => {
    expect(OG_CACHE_CONTROL).toMatch(/^public, max-age=\d+/);
    expect(OG_CACHE_CONTROL).not.toMatch(/immutable|no-store|private/);
  });
});

describe('surfaces of the new paths', () => {
  it('serves /sss from the marketing surface (nonce CSP, indexable)', () => {
    expect(surfaceFor('/sss')).toMatchObject({ name: 'marketing', csp: 'nonce', noindex: false });
  });

  it('leaves the card images indexable and their caching to the route', () => {
    for (const path of [SITE_OG_IMAGE.path, '/og/blog/kadro-nasil-kurulur']) {
      const surface = surfaceFor(path);
      expect(surface.noindex, path).toBe(false);
      expect(surface.cacheControl, path).toBeNull();
    }
  });
});

describe('llms files', () => {
  const patterns = routePatterns();

  for (const name of ['llms.txt', 'llms-full.txt']) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the two fixed file names
    const text = readFileSync(join(WEB_DIR, 'public', name), 'utf8');
    const listed = [...text.matchAll(/:\s*(\/[^\s]*)\s*$/gm)].map((match) => match[1] ?? '');

    it(`${name} lists /sss and only routes that exist`, () => {
      expect(listed).toContain('/sss');
      expect(listed.length).toBeGreaterThanOrEqual(8);
      for (const path of listed) {
        const pattern = path.replace(/\{([a-z]+)\}/g, '[$1]');
        expect(patterns.has(pattern), path).toBe(true);
      }
    });

    it(`${name} keeps the portfolio sentence`, () => {
      expect(text).toContain('Kadro bir portfolyo projesidir.');
    });
  }
});
