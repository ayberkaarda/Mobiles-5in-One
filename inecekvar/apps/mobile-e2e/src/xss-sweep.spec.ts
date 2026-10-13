import { expect, type Page, test } from '@playwright/test';
import {
  auditLive,
  buildXssWorld,
  guard,
  type Guard,
  PASSWORD,
  XSS_CITY,
  type XssWorld,
} from '../../web-e2e/src/xss-world';

/**
 * Item 16 stored-XSS sweep on the PWA (ADR-0052): the shared payload list is written through
 * the real API (`apps/web-e2e/src/xss-world.ts`) and every PWA surface that shows stored text is
 * checked on the production build: search results, line and stop detail, planner suggestions,
 * favourites, the contributor's proposals with rejection reasons, and the offline pack manager.
 * Each surface must show the payload as text, create no element or handler from it, open no
 * dialog and report no CSP violation. Environment as `sign-in-contribute.spec.ts`: IV_E2E_API,
 * IV_E2E_MAIL and IV_E2E_PSQL_CONTAINER (roles and the city row); without the container the
 * sweep is reported as skipped.
 */
const API = (process.env['IV_E2E_API'] ?? 'http://127.0.0.1:57980') + '/v1';
const MAIL = process.env['IV_E2E_MAIL'] ?? 'http://127.0.0.1:57825';
const PSQL = process.env['IV_E2E_PSQL_CONTAINER'];
const stamp = 'm' + Date.now().toString(36);

test.skip(!PSQL, 'needs IV_E2E_PSQL_CONTAINER (roles and the sweep city are set in the database)');
test.describe.configure({ mode: 'serial' });
test.use({ serviceWorkers: 'block' });

let world: XssWorld;

test.beforeAll(async ({ request }, testInfo) => {
  testInfo.setTimeout(300_000);
  world = await buildXssWorld(request, {
    api: API,
    mailUi: MAIL,
    psqlContainer: PSQL as string,
    stamp,
  });
});

async function selectCity(page: Page): Promise<void> {
  await page.goto('/ara');
  await page.evaluate((city) => localStorage.setItem('CapacitorStorage.iv.city', city), XSS_CITY);
}

async function bodyContains(page: Page, expected: string, where: string): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.body.textContent ?? ''), { message: where })
    .toContain(expected);
}

async function settle(page: Page, watch: Guard, where: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await auditLive(page, where);
  expect(watch.dialogs, where).toEqual([]);
  expect(await watch.violations(), where).toEqual([]);
}

test('search results, line and stop detail render the payloads as text', async ({ page }) => {
  test.setTimeout(300_000);
  const watch = await guard(page);
  await selectCity(page);
  await page.goto('/ara');
  await page.locator('ion-searchbar input').fill('X-');
  for (const line of world.lines.slice(0, 5)) {
    await bodyContains(page, line.name, `search ${line.payload.name}`);
  }
  await settle(page, watch, 'search results');
  for (const line of world.lines) {
    const where = `line ${line.payload.name}`;
    await page.goto(`/hat/${line.slug}?city=${XSS_CITY}`);
    await bodyContains(page, line.name, where);
    await bodyContains(page, line.hours, where);
    await bodyContains(page, line.notes, where);
    await settle(page, watch, where);
  }
  for (const stop of world.stops) {
    const where = `stop ${stop.payload.name}`;
    await page.goto(`/durak/${stop.slug}?city=${XSS_CITY}`);
    await bodyContains(page, stop.name, where);
    await settle(page, watch, where);
  }
});

test('planner suggestions and favourites render the payloads as text', async ({ page }) => {
  test.setTimeout(180_000);
  const watch = await guard(page);
  await selectCity(page);
  await page.goto('/planla');
  const field = page.locator('#iv-plan-from');
  await field.fill('script');
  await expect(page.locator('.suggestions li').first()).toBeVisible();
  await settle(page, watch, 'planner suggestions');
  const scriptStop = world.stops.find((stop) => stop.payload.name === 'script-element');
  expect(scriptStop).toBeTruthy();
  await bodyContains(page, scriptStop?.name ?? '', 'planner suggestion text');
  await field.fill('svg');
  await expect(page.locator('.suggestions li').first()).toBeVisible();
  await settle(page, watch, 'planner suggestions svg');

  for (const line of world.lines.slice(0, 6)) {
    await page.goto(`/hat/${line.slug}?city=${XSS_CITY}`);
    await bodyContains(page, line.name, `favourite ${line.payload.name}`);
    await page.locator('iv-line-page button.star').click();
    await expect(page.locator('iv-line-page button.star')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.goto('/favoriler');
  for (const line of world.lines.slice(0, 6)) {
    await bodyContains(page, line.name, `favourites ${line.payload.name}`);
  }
  await settle(page, watch, 'favourites');
});

test('my proposals show names and rejection reasons as text; pack manager stays clean', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const watch = await guard(page);
  await selectCity(page);
  await page.goto('/giris');
  await page.locator('#iv-signin-email').fill(world.contributor.email);
  await page.locator('#iv-signin-password').fill(PASSWORD);
  await page.locator('iv-signin-page form button[type="submit"]').click();
  await expect(page).not.toHaveURL(/\/giris(\?|$)/);
  await page.goto('/katki/onerilerim');
  await expect(page.locator('.list > li').first()).toBeVisible();
  for (const rejected of world.rejected.slice(0, 8)) {
    await bodyContains(page, rejected.reason, `reason ${rejected.payload.name}`);
  }
  await expect(page.locator('.list > li[data-state="rejected"] .reason')).toHaveCount(
    world.rejected.length,
  );
  for (const pending of world.pending.slice(0, 5)) {
    await bodyContains(page, pending.name.slice(0, 200), `subject ${pending.payload.name}`);
  }
  await settle(page, watch, 'my proposals');

  await page.goto('/ayarlar/cevrimdisi');
  await bodyContains(page, 'XSS Deneme Şehri', 'pack manager');
  await settle(page, watch, 'pack manager');
});
