import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILD_PRESENT, freePort } from '../security/support/server';
import { createMigratedDatabase, type TestDatabase } from '../support/db';
import { testEnvSource } from '../support/env';
import { createRoleLogins, type RoleLogins } from '../support/jobs';
import { prerequisite } from '../support/prerequisite';
import { HOSTILE, seed, slugs } from './fixtures';
import { type AuditResult, PAGE_AUDIT } from './page-audit';

/**
 * Web quality gates on the production build (ADR-0059): self-hosted brand fonts, JSON-LD
 * structure on every page that carries it, and an in-browser accessibility audit of the marketing
 * and programmatic pages. The Lighthouse scores are measured by `pnpm lighthouse` (see
 * `lighthouserc.cjs`), not here. Needs a build, Docker (database) and a local Chrome or Edge;
 * skipped locally when one is missing, an error under CI=true.
 */

// eslint-disable-next-line no-restricted-properties -- test-run setting, not application configuration
const BROWSER_OVERRIDE = process.env.KADRO_TEST_BROWSER;
const BROWSERS =
  BROWSER_OVERRIDE !== undefined && BROWSER_OVERRIDE !== ''
    ? [BROWSER_OVERRIDE]
    : [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      ];
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed candidates or the test-run override
const BROWSER = BROWSERS.find((candidate) => existsSync(candidate));
const ENABLED = prerequisite(
  BUILD_PRESENT && BROWSER !== undefined,
  'web-quality.test',
  BUILD_PRESENT
    ? `no Chrome or Edge executable at ${BROWSERS.join(', ')}`
    : 'apps/web/.next/BUILD_ID is missing, run `pnpm build` first',
);

const APP_DIR = fileURLToPath(new URL('../../', import.meta.url));
const NEXT_BIN = fileURLToPath(new URL('../../node_modules/next/dist/bin/next', import.meta.url));
const FONT_DIR = fileURLToPath(new URL('../../public/fonts/', import.meta.url));

let database: TestDatabase | undefined;
let logins: RoleLogins | undefined;
let server: ChildProcess | undefined;
let browser: ChildProcess | undefined;
let profile = '';
let base = '';
let devtools = '';
let output = '';

/** The five public pages that exist on this branch: two marketing, one venue, one district. */
const PAGES = [
  { name: 'home', path: '/', jsonLd: false },
  { name: 'features', path: '/ozellikler', jsonLd: false },
  { name: 'venue', path: `/saha/${slugs.verified}`, jsonLd: true },
  { name: 'venue with hostile name', path: `/saha/${slugs.hostile}`, jsonLd: true },
  { name: 'district', path: `/eksik-var/${slugs.il}/${slugs.district}`, jsonLd: true },
] as const;

async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if (await check()) {
        return;
      }
    } catch {
      // not ready yet
    }
    if (Date.now() > deadline) {
      throw new Error(`${what} did not become ready\n${output}`);
    }
    await delay(250);
  }
}

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

function ldBlocks(html: string): LdBlock[] {
  return [...html.matchAll(/(<script type="application\/ld\+json"[^>]*>)([^<]*)<\/script>/g)].map(
    (match) => ({
      tag: match[1] ?? '',
      text: match[2] ?? '',
      data: JSON.parse(match[2] ?? '') as Record<string, unknown>,
    }),
  );
}

function graphOf(block: LdBlock): Record<string, unknown>[] {
  return block.data['@graph'] as Record<string, unknown>[];
}

class Cdp {
  private nextId = 1;
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>();

  private constructor(private readonly socket: WebSocket) {
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Record<string, unknown>;
      if (typeof message.id === 'number') {
        this.pending.get(message.id)?.(message);
        this.pending.delete(message.id);
      }
    });
  }

  static async connect(url: string): Promise<Cdp> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => {
        resolve();
      });
      socket.addEventListener('error', () => {
        reject(new Error('devtools connection failed'));
      });
    });
    return new Cdp(socket);
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate<T>(expression: string): Promise<T> {
    const reply = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    return ((reply.result as { result: { value: T } }).result as { value: T }).value;
  }

  close(): void {
    this.socket.close();
  }
}

async function openPage(): Promise<Cdp> {
  const response = await fetch(`${devtools}/json/new?about:blank`, { method: 'PUT' });
  const target = (await response.json()) as { webSocketDebuggerUrl: string };
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  return cdp;
}

describe.skipIf(!ENABLED)('web quality gates (production build)', { timeout: 120_000 }, () => {
  beforeAll(async () => {
    database = await createMigratedDatabase('web_quality');
    logins = await createRoleLogins(database.url);
    await seed(database.client.db);
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn(
      process.execPath,
      [NEXT_BIN, 'start', '--port', String(port), '-H', '127.0.0.1'],
      {
        cwd: APP_DIR,
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
    const collect = (chunk: Buffer) => {
      output += chunk.toString('utf8');
    };
    server.stdout?.on('data', collect);
    server.stderr?.on('data', collect);
    await waitFor(async () => (await fetch(`${base}/api/v1/health`)).ok, 'built server');

    const debugPort = await freePort();
    devtools = `http://127.0.0.1:${debugPort}`;
    profile = mkdtempSync(join(tmpdir(), 'kadro-quality-'));
    browser = spawn(
      BROWSER ?? '',
      [
        '--headless=new',
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        'about:blank',
      ],
      { stdio: 'ignore', windowsHide: true },
    );
    await waitFor(async () => (await fetch(`${devtools}/json/version`)).ok, 'browser');
  }, 180_000);

  afterAll(async () => {
    browser?.kill();
    if (server !== undefined && server.exitCode === null) {
      const exited = new Promise((resolve) => server?.once('exit', resolve));
      server.kill();
      await exited;
    }
    await logins?.drop();
    await database?.dispose();
    await delay(500);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });

  describe('self-hosted fonts', () => {
    const FILES = [
      'inter-latin-wght-normal.woff2',
      'inter-latin-ext-wght-normal.woff2',
      'sora-latin-wght-normal.woff2',
      'sora-latin-ext-wght-normal.woff2',
    ];

    it('serves every font file from the same origin as WOFF2', async () => {
      for (const file of FILES) {
        const response = await fetch(`${base}/fonts/${file}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        expect(response.status, file).toBe(200);
        expect(String.fromCharCode(...bytes.slice(0, 4)), file).toBe('wOF2');
      }
    });

    it('declares the faces with font-display swap, same-origin URLs only, and no CDN', async () => {
      const { html } = await get('/');
      const sheets = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
      expect(sheets.length).toBeGreaterThan(0);
      let css = '';
      for (const sheet of sheets) {
        css += await (await fetch(new URL(sheet ?? '', base))).text();
      }
      const faces = css.match(/@font-face\{[^}]*\}/g) ?? [];
      expect(faces).toHaveLength(4);
      for (const face of faces) {
        expect(face).toContain('font-display:swap');
        expect(face).toMatch(/url\(\/?fonts\/|url\(\/fonts\//);
        expect(face).not.toMatch(/https?:/);
        expect(face).toContain('unicode-range');
      }
      expect(css).not.toMatch(/fonts\.(googleapis|gstatic)\.com|fontsource\.org|cdn\./);
      // The latin-ext faces carry the Turkish letters; they must be declared.
      expect(css).toContain('inter-latin-ext-wght-normal.woff2');
      expect(css).toContain('sora-latin-ext-wght-normal.woff2');
    });

    it('preloads the latin faces with crossorigin and allows fonts from self only', async () => {
      const { response, html } = await get('/');
      const preloads = [...html.matchAll(/<link rel="preload"[^>]*as="font"[^>]*>/g)].map(
        (m) => m[0],
      );
      expect(preloads).toHaveLength(2);
      for (const tag of preloads) {
        expect(tag).toContain('type="font/woff2"');
        expect(tag).toContain('crossorigin');
        expect(tag).toContain('/fonts/');
      }
      expect(response.headers.get('content-security-policy') ?? '').toContain("font-src 'self'");
    });

    it('ships the license text next to the fonts', () => {
      for (const file of ['inter-OFL.txt', 'sora-OFL.txt']) {
        // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file names in the package
        expect(readFileSync(join(FONT_DIR, file), 'utf8')).toContain('SIL OPEN FONT LICENSE');
      }
    });
  });

  describe('JSON-LD structure', () => {
    for (const page of PAGES) {
      it(`${page.name}: every script has the response nonce; structured data is valid`, async () => {
        const { response, html } = await get(page.path);
        expect(response.status, output).toBe(200);
        const nonce = nonceOf(response);
        const tags = html.match(/<script\b[^>]*>/g) ?? [];
        expect(tags.length).toBeGreaterThan(0);
        for (const tag of tags) {
          expect(tag, tag).toContain(`nonce="${nonce}"`);
        }
        const blocks = ldBlocks(html);
        if (!page.jsonLd) {
          // Marketing pages carry no structured data on this branch; a block would still be checked.
          for (const block of blocks) {
            expect(block.data['@context']).toBe('https://schema.org');
          }
          return;
        }
        expect(blocks).toHaveLength(1);
        const [block] = blocks;
        expect(block?.tag).toContain(`nonce="${nonce}"`);
        // Raw markup characters never appear inside the data block.
        expect(block?.text).not.toMatch(/[<>&\u2028\u2029]/);
        expect(block?.data['@context']).toBe('https://schema.org');
        const graph = graphOf(block as LdBlock);
        expect(Array.isArray(graph)).toBe(true);
        for (const node of graph) {
          expect(typeof node['@type']).toBe('string');
        }
        const crumbs = graph.find((node) => node['@type'] === 'BreadcrumbList');
        expect(crumbs, 'BreadcrumbList').toBeDefined();
        const items = crumbs?.itemListElement as Record<string, unknown>[];
        expect(items.length).toBeGreaterThanOrEqual(2);
        items.forEach((item, index) => {
          expect(item['@type']).toBe('ListItem');
          expect(item.position).toBe(index + 1);
          expect(typeof item.name).toBe('string');
          expect(String(item.item).startsWith(`${base}/`)).toBe(true);
        });
        if (page.path.startsWith('/saha/')) {
          const place = graph.find((node) => node['@type'] === 'SportsActivityLocation');
          expect(place, 'SportsActivityLocation').toBeDefined();
          expect(place?.name).toEqual(expect.any(String));
          expect(String(place?.url)).toBe(`${base}${page.path}`);
          expect(place?.address).toMatchObject({ '@type': 'PostalAddress', addressCountry: 'TR' });
          expect(place?.geo).toMatchObject({ '@type': 'GeoCoordinates' });
          // Fewer than three reviews: no aggregateRating (spec section 7).
          expect(place).not.toHaveProperty('aggregateRating');
        }
      });
    }

    it('keeps a hostile venue name as data: escaped in the markup, intact after parsing', async () => {
      const { html } = await get(`/saha/${slugs.hostile}`);
      expect(html).not.toContain('</script><script>alert(1)');
      const [block] = ldBlocks(html);
      expect(block?.text).toContain('\\u003c/script\\u003e');
      const place = graphOf(block as LdBlock).find((n) => n['@type'] === 'SportsActivityLocation');
      expect(place?.name).toContain(HOSTILE);
    });
  });

  describe('accessibility audit (in-browser, no axe-core dependency)', () => {
    it('detects the defects it claims to detect (negative control)', async () => {
      const bad =
        '<html><body><img src="x.png"><button></button><h3>x</h3>' +
        '<p style="color:#bbb;background:#fff">pale</p></body></html>';
      const cdp = await openPage();
      try {
        await cdp.send('Page.navigate', { url: `data:text/html,${encodeURIComponent(bad)}` });
        await waitFor(
          async () => (await cdp.evaluate<string>('document.readyState')) === 'complete',
          'page load',
        );
        const result = JSON.parse(await cdp.evaluate<string>(PAGE_AUDIT)) as AuditResult;
        const rules = new Set(result.violations.map((violation) => violation.rule));
        for (const rule of [
          'document-title',
          'html-has-lang',
          'page-has-one-h1',
          'landmark-one-main',
          'image-alt',
          'button-name',
          'color-contrast',
        ]) {
          expect(rules, rule).toContain(rule);
        }
      } finally {
        cdp.close();
      }
    });

    for (const page of PAGES) {
      it(`${page.name}: no violations`, async () => {
        const cdp = await openPage();
        try {
          await cdp.send('Page.navigate', { url: `${base}${page.path}` });
          await waitFor(
            async () => (await cdp.evaluate<string>('document.readyState')) === 'complete',
            'page load',
          );
          await delay(500);
          const result = JSON.parse(await cdp.evaluate<string>(PAGE_AUDIT)) as AuditResult;
          expect(result.violations, JSON.stringify(result.violations, null, 1)).toEqual([]);
        } finally {
          cdp.close();
        }
      });
    }
  });
});
