import { expect, type Page, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readPwaHeaders } from '../../mobile/scripts/pwa-headers.mjs';

/**
 * The PWA under its production Content-Security-Policy (spec sections 6.9 and 6.16, ADR-0055):
 * `serve.mjs` sends the `(pwa_headers)` snippet of ops/Caddyfile, and this scenario loads the
 * shell, lets the service worker take control, opens a line page so the lazy map chunk and the
 * MapLibre worker module load, and requires zero CSP violations in the page, in its workers and
 * in the console, with Ionic's runtime styles applied. Same stack as `offline-pack.spec.ts`.
 */
const CITY = 'ornek-test-sehri';

declare global {
  interface Window {
    __ivCsp: string[];
  }
}

async function controlledByServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.getRegistration().then((r) => !!r?.active),
    null,
    { timeout: 60_000 },
  );
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
}

test('the PWA runs under the Caddy CSP with no violation, map and service worker included', async ({
  page,
}) => {
  const violations: string[] = [];
  const workerUrls: string[] = [];
  page.on('console', (message) => {
    if (
      /Content Security Policy|Refused to (load|execute|apply|connect|create)/i.test(message.text())
    ) {
      violations.push(`console: ${message.text()}`);
    }
  });
  page.on('worker', (worker) => {
    workerUrls.push(worker.url());
    worker.on('console', (message) => {
      if (/Content Security Policy|Refused to/i.test(message.text())) {
        violations.push(`worker ${worker.url()}: ${message.text()}`);
      }
    });
  });
  await page.addInitScript(() => {
    window.__ivCsp = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__ivCsp.push(
        `${event.effectiveDirective} ${event.blockedURI} ${event.sourceFile}:${event.lineNumber}`,
      );
    });
  });

  const response = await page.goto('/ara');
  expect(response?.status()).toBe(200);
  const csp = response?.headers()['content-security-policy'] ?? '';
  const expected = readPwaHeaders(join(__dirname, '../../../ops/Caddyfile'), {
    ...process.env,
    INECEKVAR_PWA_UPLOAD_ORIGIN: process.env['IV_E2E_UPLOAD_ORIGIN'] ?? 'http://127.0.0.1:57900',
  });
  expect(csp).toBe(expected['Content-Security-Policy']);
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  for (const name of ['x-frame-options', 'referrer-policy', 'permissions-policy']) {
    expect(response?.headers()[name]).toBeTruthy();
  }

  // The inline loader of the shell ran: its hash is in the policy and the stylesheet switched
  // from media="print" to "all".
  const html = await response!.text();
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (m) =>
      `'sha256-${createHash('sha256')
        .update(m[1] ?? '', 'utf8')
        .digest('base64')}'`,
  );
  expect(inline.length).toBeGreaterThan(0);
  for (const hash of inline) expect(csp).toContain(hash);
  await expect(page.locator('link[rel="stylesheet"][href^="styles-"]').first()).toHaveAttribute(
    'media',
    'all',
  );

  await page.evaluate((city) => localStorage.setItem('CapacitorStorage.iv.city', city), CITY);
  await page.reload();
  await expect(page.locator('iv-city-picker .trigger-name')).toContainText('ÖRNEK');
  await controlledByServiceWorker(page);

  // Ionic's runtime styles apply (component styles are inserted at run time).
  const toolbarHeight = await page
    .locator('ion-toolbar')
    .first()
    .evaluate((el) => el.getBoundingClientRect().height);
  expect(toolbarHeight).toBeGreaterThan(30);
  expect(
    await page
      .locator('ion-tab-bar')
      .first()
      .evaluate((el) => getComputedStyle(el).display),
  ).not.toBe('inline');

  // Lazy map chunk and the MapLibre worker module under worker-src.
  const search = page.locator('iv-search-page ion-searchbar input');
  await search.fill('orn-2');
  const card = page.locator('iv-search-page .results iv-line-card', { hasText: 'ORN-2' });
  await card.locator('button.main').click();
  await expect(page).toHaveURL(/\/hat\/ornek-hat-2/);
  // The strip diagram is the default view; the map loads behind the Harita switch.
  await expect(page.locator('iv-line-page iv-route-strip circle.node')).toHaveCount(5);
  await page.getByRole('button', { name: 'Harita', exact: true }).click();
  const map = page.locator('iv-line-page iv-map');
  await expect(map).toHaveAttribute('data-status', /^(ready|no-basemap)$/, { timeout: 30_000 });
  await expect(page.locator('iv-line-page iv-map canvas.maplibregl-canvas')).toBeVisible();
  await expect
    .poll(() => workerUrls.some((url) => url.endsWith('/maplibre/maplibre-gl-worker.mjs')))
    .toBe(true);
  expect(
    await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .some((entry) => /\/map\.component-[^/]+\.js$/.test(entry.name)),
    ),
  ).toBe(true);

  violations.push(...(await page.evaluate(() => window.__ivCsp)));

  // A reload served by the service worker keeps the policy (the worker stores the response
  // headers with the shell).
  const again = await page.reload();
  expect(again?.headers()['content-security-policy']).toBe(csp);
  await expect(page.locator('iv-line-page h1')).toContainText('ORN-2');

  violations.push(...(await page.evaluate(() => window.__ivCsp)));
  expect(violations).toEqual([]);
});
