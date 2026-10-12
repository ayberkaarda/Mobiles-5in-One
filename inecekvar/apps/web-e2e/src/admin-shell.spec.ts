import { expect, type Page, test } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REAL_STACK } from '../stack-env.mjs';
import { directives, PRODUCTION, PUBLIC_HOST, TEST_ORIGIN } from './support';
import { totpAt } from './totp';

const PROXY = `http://127.0.0.1:${REAL_STACK.proxyPort}`;
const BROWSER_DIST = join(__dirname, '../../../dist/apps/web/browser');

/** The lazy admin chunk of the current build (the one carrying the admin shell marker). */
function adminChunk(): string {
  const names = readdirSync(BROWSER_DIST).filter(
    (name) =>
      name.endsWith('.js') &&
      readFileSync(join(BROWSER_DIST, name), 'utf8').includes('data-iv-admin'),
  );
  expect(names).toHaveLength(1);
  return names[0] as string;
}

async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction('__ivCspViolation', (text: string) => violations.push(text));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __ivCspViolation: (text: string) => void }).__ivCspViolation(
        `${event.violatedDirective} ${event.blockedURI}`,
      );
    });
  });
  return violations;
}

test('admin responses are noindex, never cached and carry the CSP', async ({ request }) => {
  for (const [origin, headers] of [
    [TEST_ORIGIN, {}],
    [PRODUCTION, PUBLIC_HOST],
  ] as const) {
    for (const path of ['/admin', '/admin/kuyruk', '/admin/denetim']) {
      const first = await request.get(origin + path, { headers });
      expect(first.status(), path).toBe(200);
      const head = first.headers();
      expect(head['x-robots-tag']).toBe('noindex, nofollow');
      expect(head['cache-control']).toBe('no-store');
      const csp = directives(head['content-security-policy'] ?? '');
      expect(csp.get('frame-ancestors')).toEqual(["'none'"]);
      expect(csp.get('object-src')).toEqual(["'none'"]);
      const nonce = (csp.get('script-src') ?? []).find((value) => value.startsWith("'nonce-"));
      const body = await first.text();
      expect(body).toContain(`ngcspnonce="${nonce?.slice(7, -1)}"`);
      // The client shell only: no server-rendered admin content, no session data.
      expect(body).not.toContain('Yönetim girişi');
      if (origin === TEST_ORIGIN) {
        expect(head['x-cache']).toBe('BYPASS');
        expect((await request.get(origin + path)).headers()['x-cache']).toBe('BYPASS');
      }
    }
  }
});

test('robots and sitemaps keep the admin area out', async ({ request }) => {
  const robots = await request.get(`${PRODUCTION}/robots.txt`, { headers: PUBLIC_HOST });
  expect(await robots.text()).toContain('Disallow: /admin\n');
  const index = await request.get(`${PRODUCTION}/sitemap.xml`, { headers: PUBLIC_HOST });
  expect(index.status()).toBe(200);
  const text = await index.text();
  expect(text).not.toContain('/admin');
  for (const match of text.matchAll(/<loc>https:\/\/inecekvar\.app(\/[^<]+)<\/loc>/g)) {
    const child = await request.get(PRODUCTION + match[1], { headers: PUBLIC_HOST });
    expect(await child.text()).not.toContain('/admin');
  }
});

test('public pages never load the admin chunk', async ({ page }) => {
  const chunk = adminChunk();
  const requested: string[] = [];
  page.on('request', (request) => requested.push(request.url()));
  for (const path of ['/', '/istanbul', '/istanbul/hat/kadikoy-bostanci', '/sss']) {
    await page.goto(TEST_ORIGIN + path);
    await page.waitForLoadState('networkidle');
  }
  expect(requested.some((url) => url.endsWith('/' + chunk))).toBe(false);
});

test('the sign-in screen renders in the browser with noindex and no CSP report', async ({
  page,
}) => {
  const violations = await watchCsp(page);
  const chunk = adminChunk();
  const chunkLoaded = page.waitForRequest((request) => request.url().endsWith('/' + chunk));
  await page.goto(`${PROXY}/admin`);
  await chunkLoaded;
  await expect(page).toHaveURL(/\/admin\/giris$/);
  await expect(page.locator('h1')).toHaveText('Yönetim girişi');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,nofollow');
  await expect(page).toHaveTitle('Yönetim | İnecek Var');
  for (const id of ['iv-admin-email', 'iv-admin-password']) {
    await expect(page.locator(`label[for="${id}"]`)).toHaveCount(1);
  }
  expect(violations).toEqual([]);
  expect(await page.evaluate(() => ({ ...localStorage, ...sessionStorage }))).toEqual({});
});

test('the TOTP helper matches the RFC 6238 vector', () => {
  // RFC 6238 appendix B, SHA-1 key "12345678901234567890", T = 59 s, last six digits.
  expect(totpAt('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1)).toBe('287082');
});
