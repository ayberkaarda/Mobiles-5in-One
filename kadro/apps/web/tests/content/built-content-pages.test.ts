import { type ChildProcess, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILD_PRESENT, freePort } from '../security/support/server';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { testEnvSource } from '../support/env';
import { createRoleLogins, type RoleLogins } from '../support/jobs';
import { prerequisite } from '../support/prerequisite';

/**
 * Blog, legal and contact pages and the site structured data against the production build
 * (`next start`) (ADR-0055, ADR-0080): per-request nonce on every script including the JSON-LD
 * blocks, parseable and escaped structured data, canonical URLs, the visible sample notice on the
 * legal pages, 404 for unknown articles and the sitemap entries.
 */

const ENABLED = prerequisite(
  BUILD_PRESENT,
  'built-content-pages.test',
  'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));

// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed content directory of this package
const BLOG_SLUGS_SOURCE = readdirSync(new URL('../../content/blog/', import.meta.url))
  .filter((name) => name.endsWith('.mdx'))
  .map((name) => name.slice(0, -'.mdx'.length));

let database: TestDatabase | undefined;
let logins: RoleLogins | undefined;
let child: ChildProcess | undefined;
let base = '';
let output = '';

async function get(path: string): Promise<{ response: Response; html: string }> {
  const response = await fetch(`${base}${path}`);
  return { response, html: await response.text() };
}

function nonceOf(response: Response): string {
  const csp = response.headers.get('content-security-policy') ?? '';
  const nonce = /script-src 'self' 'nonce-([A-Za-z0-9+/=]+)' 'strict-dynamic'/.exec(csp)?.[1];
  expect(nonce, csp).toBeDefined();
  return nonce ?? '';
}

interface LdBlock {
  readonly tag: string;
  readonly text: string;
  readonly data: Record<string, unknown>;
}

/** Every script element carries the response nonce; returns the JSON-LD blocks. */
function noncedBlocks(response: Response, html: string): LdBlock[] {
  const nonce = nonceOf(response);
  const tags = html.match(/<script\b[^>]*>/g) ?? [];
  expect(tags.length).toBeGreaterThan(0);
  for (const tag of tags) {
    expect(tag).toContain(`nonce="${nonce}"`);
  }
  return [...html.matchAll(/(<script type="application\/ld\+json"[^>]*>)([^<]*)<\/script>/g)].map(
    (match) => ({
      tag: match[1] ?? '',
      text: match[2] ?? '',
      data: JSON.parse(match[2] ?? '') as Record<string, unknown>,
    }),
  );
}

function graphOf(block: LdBlock | undefined): Record<string, unknown>[] {
  return (block?.data['@graph'] as Record<string, unknown>[] | undefined) ?? [];
}

function canonicalOf(html: string): string | undefined {
  return /<link rel="canonical" href="([^"]+)"/.exec(html)?.[1];
}

function robotsOf(html: string): string | undefined {
  return /<meta name="robots" content="([^"]+)"/.exec(html)?.[1];
}

function titleOf(html: string): string {
  return /<title>([^<]*)<\/title>/.exec(html)?.[1] ?? '';
}

function expectHeadingsInOrder(html: string): void {
  const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
  expect(levels[0]).toBe(1);
  expect(levels.filter((level) => level === 1)).toHaveLength(1);
  for (let index = 1; index < levels.length; index += 1) {
    expect(levels[index] ?? 1).toBeLessThanOrEqual((levels[index - 1] ?? 1) + 1);
  }
}

describe.skipIf(!ENABLED)('blog, legal and contact pages (production build)', () => {
  beforeAll(async () => {
    database = await createMigratedDatabase('web_content_built');
    logins = await createRoleLogins(database.url);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(
      process.execPath,
      [NEXT_BIN, 'start', '--port', String(port), '-H', '127.0.0.1'],
      {
        cwd: APP_DIR,
        // Only the test configuration built above: no variable of the calling shell is inherited.
        env: {
          ...testEnvSource({
            WEB_ORIGIN: base,
            CORS_ALLOWED_ORIGINS: base,
            DATABASE_URL: logins.appUrl,
          }),
          NODE_ENV: 'production',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const response = await fetch(`${base}/api/v1/health`);
        await response.arrayBuffer();
        if (response.ok) {
          break;
        }
      } catch {
        // not listening yet
      }
      if (Date.now() > deadline || child.exitCode !== null) {
        throw new Error(`built server did not become ready\n${output}`);
      }
      await delay(250);
    }
  }, 120_000);

  afterAll(async () => {
    if (child !== undefined && child.exitCode === null) {
      const exited = new Promise((resolve) => child?.once('exit', resolve));
      child.kill();
      await exited;
    }
    await logins?.drop();
    await database?.dispose();
  });

  it('renders the blog index with every article, the nonce and Blog structured data', async () => {
    const { response, html } = await get('/blog');
    expect(response.status, output).toBe(200);
    expect(response.headers.get('cache-control') ?? '').toMatch(/private|no-store/);
    const blocks = noncedBlocks(response, html);
    expect(blocks).toHaveLength(1);
    expect(graphOf(blocks[0]).map((node) => node['@type'])).toEqual([
      'BreadcrumbList',
      'Blog',
      'Organization',
    ]);
    expect(canonicalOf(html)).toBe(`${base}/blog`);
    expect(robotsOf(html)).toBeUndefined();
    expectHeadingsInOrder(html);
    for (const slug of BLOG_SLUGS_SOURCE) {
      expect(html).toContain(`href="/blog/${slug}"`);
    }
    expect(html.match(/<li>\d+ dk okuma<\/li>/g)).toHaveLength(BLOG_SLUGS_SOURCE.length);
    expect(titleOf(html)).toBe('Blog · Kadro');
  });

  it('renders every article with canonical URL, Article JSON-LD, reading time and internal links', async () => {
    for (const slug of BLOG_SLUGS_SOURCE) {
      const { response, html } = await get(`/blog/${slug}`);
      expect(response.status, `${slug}\n${output}`).toBe(200);
      const blocks = noncedBlocks(response, html);
      expect(blocks, slug).toHaveLength(1);
      const [block] = blocks;
      expect(block?.tag).toContain(`nonce="${nonceOf(response)}"`);
      expect(block?.text, slug).not.toMatch(/[<>&\u2028\u2029]/);
      const graph = graphOf(block);
      expect(
        graph.map((node) => node['@type']),
        slug,
      ).toEqual(['BreadcrumbList', 'Article', 'Organization']);
      const article = graph[1];
      expect(article, slug).toMatchObject({
        url: `${base}/blog/${slug}`,
        inLanguage: 'tr-TR',
        datePublished: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
        dateModified: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
      });
      const items = (graph[0]?.itemListElement ?? []) as Record<string, unknown>[];
      expect(items.map((item) => item.item)).toEqual([
        `${base}/`,
        `${base}/blog`,
        `${base}/blog/${slug}`,
      ]);
      expect(canonicalOf(html), slug).toBe(`${base}/blog/${slug}`);
      expect(robotsOf(html), slug).toBeUndefined();
      expect(titleOf(html).length, slug).toBeLessThanOrEqual(60);
      expect(titleOf(html), slug).toMatch(/ · Kadro$/);
      expect(html, slug).toMatch(/<li>\d+ dk okuma<\/li>/);
      expect(html, slug).toContain('href="/blog"');
      expect(html, slug).toContain('href="/ozellikler"');
      expect(html, slug).toMatch(/<time dateTime="\d{4}-\d{2}-\d{2}">/);
      expect(html, slug).toContain('Diğer yazılar');
      expectHeadingsInOrder(html);
      expect(html, slug).not.toContain(`href="/blog/${slug}"`);
    }
  });

  it('answers 404 with noindex for unknown or malformed article slugs', async () => {
    for (const slug of [
      'yok-boyle-bir-yazi',
      'Kadro-Nasil-Kurulur',
      '..%2Flegal%2Fgizlilik',
      'a--b',
    ]) {
      const { response, html } = await get(`/blog/${slug}`);
      expect([400, 404], slug).toContain(response.status);
      expect(html, slug).not.toContain('dk okuma');
    }
    const missing = await get('/blog/yok-boyle-bir-yazi');
    expect(robotsOf(missing.html)).toMatch(/noindex/);
  });

  it('renders the legal pages with a visible sample notice, canonical URL and the nonce', async () => {
    for (const path of ['/gizlilik', '/kvkk-aydinlatma']) {
      const { response, html } = await get(path);
      expect(response.status, `${path}\n${output}`).toBe(200);
      noncedBlocks(response, html);
      expect(html, path).toContain('role="note"');
      expect(html, path).toContain('Örnek metin');
      expect(html, path).toContain('Kadro bir portfolyo projesidir.');
      expect(canonicalOf(html), path).toBe(`${base}${path}`);
      // Sample pages stay indexable; only the visible notice marks them.
      expect(robotsOf(html), path).toBeUndefined();
      expect(response.headers.get('x-robots-tag'), path).toBeNull();
      expect(titleOf(html).length, path).toBeLessThanOrEqual(60);
      expectHeadingsInOrder(html);
      expect(html, path).not.toMatch(/dangerouslySetInnerHTML|javascript:/);
    }
    const kvkk = await get('/kvkk-aydinlatma');
    expect(kvkk.html).toContain('<table>');
    expect(kvkk.html).toContain('href="/hesap-silme"');
    const privacy = await get('/gizlilik');
    expect(privacy.html).toContain('href="/kvkk-aydinlatma"');
  });

  it('renders the sample-labelled contact page without inventing a channel', async () => {
    const { response, html } = await get('/iletisim');
    expect(response.status, output).toBe(200);
    noncedBlocks(response, html);
    expect(html).toContain('role="note"');
    expect(html).toContain('Örnek metin');
    expect(html).not.toMatch(/mailto:|tel:|@[a-z0-9-]+\.[a-z]/i);
    expect(canonicalOf(html)).toBe(`${base}/iletisim`);
  });

  it('puts Organization and MobileApplication on the home page and /ozellikler', async () => {
    for (const path of ['/', '/ozellikler']) {
      const { response, html } = await get(path);
      expect(response.status, path).toBe(200);
      const blocks = noncedBlocks(response, html);
      expect(blocks, path).toHaveLength(1);
      expect(blocks[0]?.text, path).not.toMatch(/[<>&\u2028\u2029]/);
      const graph = graphOf(blocks[0]);
      expect(
        graph.map((node) => node['@type']),
        path,
      ).toEqual(['Organization', 'MobileApplication']);
      expect(graph[0]?.url).toBe(`${base}/`);
      expect(graph[1]).toMatchObject({
        applicationCategory: 'SportsApplication',
        operatingSystem: 'iOS, Android',
      });
      expect(graph[1]).not.toHaveProperty('aggregateRating');
    }
  });

  it('links blog, legal and contact pages from the shell navigation', async () => {
    const { html } = await get('/');
    for (const href of ['/blog', '/gizlilik', '/kvkk-aydinlatma', '/iletisim', '/hesap-silme']) {
      expect(html, href).toContain(`href="${href}"`);
    }
  });

  it('lists the blog and legal pages in the sitemap', async () => {
    const response = await fetch(`${base}/sitemap.xml`);
    const xml = await response.text();
    expect(response.status, output).toBe(200);
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    for (const path of ['/blog', '/gizlilik', '/kvkk-aydinlatma', '/iletisim']) {
      expect(locations, path).toContain(`${base}${path}`);
    }
    for (const slug of BLOG_SLUGS_SOURCE) {
      expect(locations, slug).toContain(`${base}/blog/${slug}`);
    }
    expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}/);
  });
});
