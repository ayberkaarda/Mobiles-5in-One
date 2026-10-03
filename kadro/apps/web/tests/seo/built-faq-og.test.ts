import { type ChildProcess, spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FAQ_ENTRIES } from '../../components/content/faq';
import { BUILD_PRESENT, freePort } from '../security/support/server';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { testEnvSource } from '../support/env';
import { createRoleLogins, type RoleLogins } from '../support/jobs';
import { prerequisite } from '../support/prerequisite';

/**
 * FAQ page and card images against the production build (`next start`) (ADR-0083): the `FAQPage`
 * block parses, mirrors the rendered questions, is escaped and carries the response nonce; every
 * public page names its card image in Open Graph and Twitter tags; the image routes answer a
 * cacheable 1200 x 630 PNG; the sitemap and the llms files list `/sss`.
 */

const ENABLED = prerequisite(
  BUILD_PRESENT,
  'built-faq-og.test',
  'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));

// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed content directory of this package
const BLOG_SLUGS = readdirSync(new URL('../../content/blog/', import.meta.url))
  .filter((name) => name.endsWith('.mdx'))
  .map((name) => name.slice(0, -'.mdx'.length));

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

/** Every script element carries the response nonce; returns the JSON-LD blocks (raw and parsed). */
function noncedBlocks(response: Response, html: string) {
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

/** `content` of `<meta property|name="key">`. */
function meta(html: string, key: string): string | undefined {
  for (const match of html.matchAll(/<meta (?:property|name)="([^"]+)" content="([^"]*)"/g)) {
    if (match[1] === key) {
      return match[2];
    }
  }
  return undefined;
}

/** Decodes the character references React writes in text and attribute values. */
function decode(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

describe.skipIf(!ENABLED)('FAQ page and card images (production build)', () => {
  beforeAll(async () => {
    database = await createMigratedDatabase('web_faq_og_built');
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

  it('renders /sss with the nonce, a visible note and a FAQPage block that mirrors the page', async () => {
    const { response, html } = await get('/sss');
    expect(response.status, output).toBe(200);
    expect(response.headers.get('cache-control') ?? '').toMatch(/private|no-store/);
    expect(response.headers.get('x-robots-tag')).toBeNull();
    const blocks = noncedBlocks(response, html);
    expect(blocks).toHaveLength(1);
    const [block] = blocks;
    expect(block?.tag).toContain(`nonce="${nonceOf(response)}"`);
    expect(block?.text).not.toMatch(/[<>&]|\p{Zl}|\p{Zp}/u);
    const graph = (block?.data['@graph'] ?? []) as Record<string, unknown>[];
    expect(graph.map((node) => node['@type'])).toEqual([
      'BreadcrumbList',
      'FAQPage',
      'Organization',
    ]);
    expect(graph[1]?.url).toBe(`${base}/sss`);
    const questions = (graph[1]?.mainEntity ?? []) as Record<string, unknown>[];
    expect(questions).toHaveLength(FAQ_ENTRIES.length);
    const text = decode(html);
    questions.forEach((question, index) => {
      const entry = FAQ_ENTRIES[index];
      expect(question.name).toBe(entry?.question);
      expect((question.acceptedAnswer as Record<string, unknown>).text).toBe(entry?.answer);
      expect(text).toContain(`<h2 id="${entry?.id ?? ''}">${entry?.question ?? ''}</h2>`);
      expect(text).toContain(`<p>${entry?.answer ?? ''}</p>`);
    });
    expect(html).toContain('role="note"');
    expect(html).toContain('Kadro bir portfolyo projesidir.');
    expect(/<link rel="canonical" href="([^"]+)"/.exec(html)?.[1]).toBe(`${base}/sss`);
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe('Sık sorulan sorular · Kadro');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it('links /sss from the shell navigation', async () => {
    const { html } = await get('/');
    expect(html).toContain('href="/sss"');
  });

  it('names the card image in Open Graph and Twitter tags of every public page', async () => {
    const site = `${base}/og/kadro.png`;
    const pages: [string, string][] = [
      ['/', site],
      ['/ozellikler', site],
      ['/sss', site],
      ['/blog', site],
      ['/gizlilik', site],
      ['/iletisim', site],
      ...BLOG_SLUGS.map((slug): [string, string] => [`/blog/${slug}`, `${base}/og/blog/${slug}`]),
    ];
    for (const [path, image] of pages) {
      const { response, html } = await get(path);
      expect(response.status, `${path}\n${output}`).toBe(200);
      expect(meta(html, 'og:image'), path).toBe(image);
      expect(meta(html, 'og:image:width'), path).toBe('1200');
      expect(meta(html, 'og:image:height'), path).toBe('630');
      expect(meta(html, 'og:image:type'), path).toBe('image/png');
      expect(meta(html, 'og:image:alt'), path).toMatch(/Kadro/);
      expect(meta(html, 'twitter:card'), path).toBe('summary_large_image');
      expect(meta(html, 'twitter:image'), path).toBe(image);
      expect(html.match(/<meta property="og:image" /g), path).toHaveLength(1);
    }
  });

  it('puts the article card into the Article block', async () => {
    const slug = BLOG_SLUGS[0] ?? '';
    const { response, html } = await get(`/blog/${slug}`);
    const [block] = noncedBlocks(response, html);
    const graph = (block?.data['@graph'] ?? []) as Record<string, unknown>[];
    expect(graph[1]?.image).toBe(`${base}/og/blog/${slug}`);
  });

  it('serves every card as a cacheable 1200 x 630 PNG', async () => {
    for (const path of ['/og/kadro.png', ...BLOG_SLUGS.map((slug) => `/og/blog/${slug}`)]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status, `${path}\n${output}`).toBe(200);
      expect(response.headers.get('content-type'), path).toBe('image/png');
      const cacheControl = response.headers.get('cache-control') ?? '';
      expect(cacheControl, path).toMatch(/public/);
      expect(cacheControl, path).toMatch(/max-age=[1-9]/);
      expect(cacheControl, path).not.toMatch(/no-store|private/);
      expect(response.headers.get('x-robots-tag'), path).toBeNull();
      const body = Buffer.from(await response.arrayBuffer());
      expect(body.subarray(0, 8).equals(PNG_SIGNATURE), path).toBe(true);
      expect(body.toString('latin1', 12, 16), path).toBe('IHDR');
      expect(body.readUInt32BE(16), path).toBe(1200);
      expect(body.readUInt32BE(20), path).toBe(630);
      expect(body.length, path).toBeGreaterThan(10_000);
      expect(body.length, path).toBeLessThan(300_000);
    }
  });

  it('answers 404 for a card of an unknown article without rendering one', async () => {
    for (const slug of ['yok-boyle-bir-yazi', 'Kadro-Nasil-Kurulur']) {
      const response = await fetch(`${base}/og/blog/${slug}`);
      expect(response.status, slug).toBe(404);
      expect(response.headers.get('content-type') ?? '', slug).not.toMatch(/image\/png/);
      await response.arrayBuffer();
    }
  });

  it('lists /sss in the sitemap and in both llms files', async () => {
    const sitemap = await fetch(`${base}/sitemap.xml`);
    const xml = await sitemap.text();
    expect(sitemap.status, output).toBe(200);
    const locations = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
    expect(locations).toContain(`${base}/sss`);
    for (const name of ['/llms.txt', '/llms-full.txt']) {
      const response = await fetch(`${base}${name}`);
      expect(response.status, name).toBe(200);
      expect(response.headers.get('content-type') ?? '', name).toMatch(/^text\/plain/);
      expect(await response.text(), name).toMatch(/: \/sss$/m);
    }
  });
});
