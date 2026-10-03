import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  BLOG_INTRO,
  BLOG_META,
  CONTACT_INTRO,
  CONTACT_META,
  SAMPLE_NOTICE_TEXT,
} from '../../components/content/copy';
import { LegalPage } from '../../components/content/legal-page';
import { MarkdownView } from '../../components/content/markdown-view';
import { DESCRIPTION_MAX, renderedTitle, TITLE_MAX } from '../../components/marketing/metadata';
import {
  findDocument,
  loadCollection,
  parseDocument,
  parseFrontMatter,
  WORDS_PER_MINUTE,
} from '../../lib/content/documents';
import { headingSlug, type Inline, isSafeHref, parseBlocks } from '../../lib/content/markdown';
import {
  articleStructuredData,
  blogIndexStructuredData,
  siteStructuredData,
} from '../../lib/server/seo/site-structured-data';
import { serializeJsonLd } from '../../components/seo/json-ld';

/**
 * Content pipeline (ADR-0080): the five articles and the two legal texts load and validate, the
 * parser accepts only the documented subset, the renderer escapes text and emits no script, and
 * the structured data has the documented shape.
 */

const APP_DIR = fileURLToPath(new URL('../../app/', import.meta.url));
const ORIGIN = 'https://kadro.example';

const BLOG_SLUGS = [
  'eksik-oyuncu-nasil-bulunur',
  'hali-saha-7v7-dizilis',
  'hali-saha-secerken-nelere-bakilir',
  'hali-saha-ucreti-nasil-bolunur',
  'kadro-nasil-kurulur',
];

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** URL paths of the pages in `app/`, route groups removed; dynamic segments stay as `[x]`. */
function pagePaths(): string[] {
  const paths: string[] = [];
  const walk = (relative: readonly string[]) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- walks this package's app dir
    for (const entry of readdirSync(join(APP_DIR, ...relative), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== 'api') {
          walk([...relative, entry.name]);
        }
      } else if (entry.name === 'page.tsx') {
        const segments = relative.filter((segment) => !segment.startsWith('('));
        paths.push(`/${segments.join('/')}`);
      }
    }
  };
  walk([]);
  return paths;
}

describe('content files', () => {
  it('loads the five blog articles, newest first, with slugs from the file names', () => {
    const articles = loadCollection('blog');
    expect(articles.map((article) => article.slug).sort()).toEqual(BLOG_SLUGS);
    const dates = articles.map((article) => article.publishedAt);
    expect([...dates].sort().reverse()).toEqual(dates);
  });

  it('holds every article to spec §7: at least 600 words, title, description, reading time', () => {
    for (const article of loadCollection('blog')) {
      expect(article.wordCount, article.slug).toBeGreaterThanOrEqual(600);
      expect(renderedTitle(article.title).length, article.slug).toBeLessThanOrEqual(TITLE_MAX);
      expect(article.description.length, article.slug).toBeLessThanOrEqual(DESCRIPTION_MAX);
      expect(article.readingMinutes, article.slug).toBe(
        Math.max(1, Math.ceil(article.wordCount / WORDS_PER_MINUTE)),
      );
      expect(article.modifiedAt >= article.publishedAt, article.slug).toBe(true);
      expect(article.sample, article.slug).toBe(false);
      // Answer-first: the article opens with a paragraph, not a heading.
      expect(article.blocks[0]?.kind, article.slug).toBe('paragraph');
    }
  });

  it('loads both legal texts as samples within the metadata limits', () => {
    const legal = loadCollection('legal');
    expect(legal.map((document) => document.slug).sort()).toEqual(['gizlilik', 'kvkk-aydinlatma']);
    for (const document of legal) {
      expect(document.sample, document.slug).toBe(true);
      expect(renderedTitle(document.title).length, document.slug).toBeLessThanOrEqual(TITLE_MAX);
      expect(document.description.length, document.slug).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it('keeps every internal link of every document on a page that exists', () => {
    const pages = new Set(pagePaths());
    const links: string[] = [];
    const collect = (nodes: readonly Inline[]) => {
      for (const node of nodes) {
        if (node.kind === 'link') {
          links.push(node.href);
          collect(node.children);
        } else if (node.kind === 'strong') {
          collect(node.children);
        }
      }
    };
    for (const document of [...loadCollection('blog'), ...loadCollection('legal')]) {
      for (const block of document.blocks) {
        if (block.kind === 'paragraph' || block.kind === 'quote') {
          collect(block.children);
        } else if (block.kind === 'list') {
          block.items.forEach(collect);
        } else if (block.kind === 'table') {
          [...block.header, ...block.rows.flat()].forEach(collect);
        }
      }
    }
    expect(links.length).toBeGreaterThan(0);
    for (const href of links.filter((link) => link.startsWith('/'))) {
      expect(pages.has(href), href).toBe(true);
    }
  });

  it('has a page for every blog and legal route', () => {
    const pages = pagePaths();
    for (const path of ['/blog', '/blog/[slug]', '/gizlilik', '/kvkk-aydinlatma', '/iletisim']) {
      expect(pages, path).toContain(path);
    }
  });

  it('finds a document only by an exact slug', () => {
    expect(findDocument('blog', 'kadro-nasil-kurulur')?.slug).toBe('kadro-nasil-kurulur');
    for (const slug of [
      '',
      '..',
      '../legal/gizlilik',
      'KADRO-NASIL-KURULUR',
      'kadro-nasil-kurulur.mdx',
    ]) {
      expect(findDocument('blog', slug), slug).toBeUndefined();
    }
  });

  it('gives every heading of an article a unique anchor', () => {
    for (const article of loadCollection('blog')) {
      const ids = article.blocks.flatMap((block) => (block.kind === 'heading' ? [block.id] : []));
      expect(new Set(ids).size, article.slug).toBe(ids.length);
    }
  });

  it('writes the copy of the index and contact pages answer-first (40 to 60 words, names Kadro)', () => {
    for (const intro of [BLOG_INTRO, CONTACT_INTRO]) {
      expect(wordCount(intro)).toBeGreaterThanOrEqual(40);
      expect(wordCount(intro)).toBeLessThanOrEqual(60);
      expect(intro).toContain('Kadro');
    }
    for (const meta of [BLOG_META, CONTACT_META]) {
      expect(renderedTitle(meta.title).length).toBeLessThanOrEqual(TITLE_MAX);
      expect(meta.description.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });
});

describe('Markdown subset parser', () => {
  it('parses headings, paragraphs, lists, quotes and tables', () => {
    const blocks = parseBlocks(
      [
        '## Başlık',
        '',
        'Bir **kalın** `kod` ve [bağlantı](/blog) satırı',
        'ikinci satır.',
        '',
        '- bir',
        '- iki',
        '',
        '1. ilk',
        '2. ikinci',
        '',
        '> Not',
        '',
        '| A | B |',
        '| --- | --- |',
        '| `x|y` | 2 |',
      ].join('\n'),
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      'heading',
      'paragraph',
      'list',
      'list',
      'quote',
      'table',
    ]);
    const table = blocks[5];
    expect(table?.kind === 'table' && table.rows[0]).toHaveLength(2);
  });

  it('rejects everything outside the subset instead of rendering it', () => {
    for (const source of [
      '# Ana başlık',
      '#### Derin başlık',
      '<script>alert(1)</script>',
      '<div>html</div>',
      '{1 + 1}',
      '<Component prop="x" />',
      '[x](javascript:alert(1))',
      '[x](//evil.example/a)',
      '[x](http://plain.example)',
      '| A | B |\n| 1 | 2 |',
      '| A | B |\n| --- | --- |\n| 1 |',
      'Kapanmamış `kod',
    ]) {
      expect(() => parseBlocks(source), source).toThrow();
    }
  });

  it('accepts only site paths and https URLs as link targets', () => {
    for (const href of ['/blog', '/gizlilik#cerezler', 'https://kvkk.gov.tr/a?b=c']) {
      expect(isSafeHref(href), href).toBe(true);
    }
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,x',
      'http://a.example',
      '//a.example',
      '/\\a.example',
      'https://user:pass@a.example',
      'mailto:a@b.c',
      'blog',
    ]) {
      expect(isSafeHref(href), href).toBe(false);
    }
  });

  it('folds Turkish letters in heading anchors', () => {
    expect(headingSlug('Çerezler ve Cihaz İzinleri')).toBe('cerezler-ve-cihaz-izinleri');
    expect(headingSlug('???')).toBe('bolum');
  });

  it('validates front matter and fails on unknown keys, bad dates and missing fields', () => {
    const good = '---\ntitle: "T"\ndescription: "D"\npublishedAt: "2026-10-02"\n---\n\nGövde.\n';
    expect(parseDocument('t', good).readingMinutes).toBe(1);
    expect(() => parseDocument('t', good.replace('2026-10-02', '2 Ekim'))).toThrow();
    expect(() => parseDocument('t', good.replace('---\n\n', 'extra: "x"\n---\n\n'))).toThrow();
    expect(() => parseDocument('t', 'Gövde.')).toThrow(/front matter/);
    expect(() => parseFrontMatter('---\ntitle: "A"\ntitle: "B"\n---\nx')).toThrow(/duplicate/);
  });
});

describe('renderer', () => {
  it('escapes text, so markup-looking content never becomes an element', () => {
    const html = renderToStaticMarkup(
      <MarkdownView blocks={parseBlocks('## <b>x</b>\n\nKod: `<script>alert(1)</script>`')} />,
    );
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('renders a legal page with the visible sample notice and no script or injected HTML', () => {
    for (const slug of ['gizlilik', 'kvkk-aydinlatma']) {
      const document = loadCollection('legal').find((entry) => entry.slug === slug);
      expect(document).toBeDefined();
      const html = renderToStaticMarkup(<LegalPage document={document as never} />);
      expect(html).toContain('role="note"');
      expect(html).toContain('Örnek metin');
      expect(html.replace(/&#x27;/g, "'")).toContain(SAMPLE_NOTICE_TEXT.slice(0, 40));
      expect(html.match(/<h1\b/g)).toHaveLength(1);
      expect(html).not.toMatch(/<script|dangerouslySetInnerHTML|javascript:/i);
    }
  });

  it('renders every article with an h1-free body, scrollable labelled tables and safe links', () => {
    for (const article of loadCollection('blog')) {
      const html = renderToStaticMarkup(<MarkdownView blocks={article.blocks} />);
      expect(html, article.slug).not.toMatch(/<h1\b|<script/);
      for (const match of html.matchAll(/href="([^"]*)"/g)) {
        expect(isSafeHref(match[1] ?? ''), article.slug).toBe(true);
      }
    }
    const kvkk = loadCollection('legal').find((entry) => entry.slug === 'kvkk-aydinlatma');
    const html = renderToStaticMarkup(<MarkdownView blocks={kvkk?.blocks ?? []} />);
    expect(html).toContain('<table>');
    expect(html).toMatch(/role="region" aria-label="Tablo" tabindex="0"/);
    expect(html).toContain('scope="col"');
  });
});

describe('structured data builders', () => {
  const article = loadCollection('blog')[0];

  it('builds Organization and MobileApplication without prices, ratings or store links', () => {
    const data = siteStructuredData(ORIGIN);
    const graph = data['@graph'] as Record<string, unknown>[];
    expect(data['@context']).toBe('https://schema.org');
    expect(graph.map((node) => node['@type'])).toEqual(['Organization', 'MobileApplication']);
    const app = graph[1];
    expect(app).toMatchObject({
      applicationCategory: 'SportsApplication',
      operatingSystem: 'iOS, Android',
    });
    expect(app).not.toHaveProperty('downloadUrl');
    expect(app).not.toHaveProperty('aggregateRating');
    expect(JSON.stringify(data)).not.toMatch(/apps\.apple\.com|play\.google\.com/);
  });

  it('builds an Article with dates, canonical URL and a three-step breadcrumb', () => {
    expect(article).toBeDefined();
    const data = articleStructuredData(ORIGIN, article as never, `/blog/${article?.slug ?? ''}`);
    const graph = data['@graph'] as Record<string, unknown>[];
    expect(graph.map((node) => node['@type'])).toEqual([
      'BreadcrumbList',
      'Article',
      'Organization',
    ]);
    const node = graph[1];
    expect(node).toMatchObject({
      headline: article?.title,
      url: `${ORIGIN}/blog/${article?.slug ?? ''}`,
      datePublished: article?.publishedAt,
      dateModified: article?.modifiedAt,
      inLanguage: 'tr-TR',
    });
    const items = (graph[0]?.itemListElement ?? []) as Record<string, unknown>[];
    expect(items.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it('builds the blog index graph', () => {
    const data = blogIndexStructuredData(ORIGIN, BLOG_META.description);
    expect((data['@graph'] as Record<string, unknown>[]).map((node) => node['@type'])).toEqual([
      'BreadcrumbList',
      'Blog',
      'Organization',
    ]);
  });

  it('serializes hostile text without raw markup characters', () => {
    const text = serializeJsonLd({ name: '</script><!--&' });
    expect(text).not.toMatch(/[<>&]/);
    expect(JSON.parse(text)).toEqual({ name: '</script><!--&' });
  });
});
