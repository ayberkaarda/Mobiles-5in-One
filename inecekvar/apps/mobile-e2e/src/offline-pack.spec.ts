import { expect, type Locator, type Page, test } from '@playwright/test';
import { join } from 'node:path';

const CITY = 'ornek-test-sehri';
const SHOTS = join(__dirname, '../../../docs/screenshots/phase3');

async function shoot(page: Page, name: string, focus?: Locator): Promise<void> {
  if (focus) await focus.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

/** Waits until the service worker controls the page (it registers once the app is stable). */
async function controlledByServiceWorker(page: Page): Promise<void> {
  await page.waitForFunction(
    () => navigator.serviceWorker.getRegistration().then((r) => !!r?.active),
    null,
    {
      timeout: 60_000,
    },
  );
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
  }
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30_000 });
}

/** True once the service worker's lazy map group holds the MapLibre chunk and worker files. */
function mapAssetsCached(page: Page) {
  return page.waitForFunction(
    async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        if (!name.startsWith('ngsw:') || !name.includes(':map:')) continue;
        const cache = await caches.open(name);
        urls.push(...(await cache.keys()).map((r) => r.url));
      }
      return (
        urls.some((u) => /\/maplibre-gl-[^/]+\.js$/.test(u)) &&
        urls.some((u) => u.endsWith('/maplibre/maplibre-gl-worker.mjs')) &&
        urls.some((u) => u.endsWith('/maplibre/maplibre-gl-shared.mjs')) &&
        urls.some((u) => /\/map\.component-[^/]+\.js$/.test(u))
      );
    },
    null,
    { timeout: 60_000, polling: 500 },
  );
}

test('installs the sample city pack and works offline after a reload', async ({
  page,
  context,
}) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  // First visit online: pick the sample city (stored like the app stores it) and let the
  // service worker install.
  await page.goto('/ara');
  await page.evaluate((city) => localStorage.setItem('CapacitorStorage.iv.city', city), CITY);
  await page.reload();
  await expect(page.locator('iv-city-picker .trigger-name')).toContainText('ÖRNEK');
  await controlledByServiceWorker(page);
  const prompt = page.locator('iv-search-page section.pack');
  await expect(prompt).toHaveAttribute('data-pack', 'none');
  await shoot(page, 'ara-pack-prompt', prompt);

  // Install the pack from Ayarlar > Çevrimdışı şehirler.
  await page.goto('/ayarlar');
  await page.getByRole('link', { name: /Çevrimdışı şehirler/ }).click();
  await expect(page).toHaveURL(/\/ayarlar\/cevrimdisi$/);
  const row = page.locator(`li.city[data-city="${CITY}"]`);
  await expect(row).toHaveAttribute('data-state', 'none');
  await row.getByRole('button', { name: 'İndir' }).click();
  await expect(row).toHaveAttribute('data-state', 'installed', { timeout: 30_000 });
  await expect(row).toContainText('Sürüm 0');
  await expect(page.locator('.storage .used')).not.toContainText(' 0 B');
  await mapAssetsCached(page);

  // The service worker caches catalog reads, never the pack itself (stored by the app) nor
  // anything about the account, sign-in or planning.
  const dataUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('ngsw:') || !name.includes(':data:')) continue;
      urls.push(...(await (await caches.open(name)).keys()).map((r) => r.url));
    }
    return urls;
  });
  expect(dataUrls.some((u) => u.endsWith('/api/v1/cities'))).toBe(true);
  expect(
    dataUrls.filter((u) => /\/pack|tiles\.pmtiles|\/me\b|\/auth|\/plan|\/traces|\/edits/.test(u)),
  ).toEqual([]);
  await shoot(page, 'packs-installed');

  // Offline: reload from the service worker and use the pack. Catalog reads must not even be
  // attempted: the pack answers them on the device.
  const catalogRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/v1\/(lines|stops)/.test(request.url())) catalogRequests.push(request.url());
  });
  await context.setOffline(true);
  await page.goto('/ara');
  await expect(page.locator('iv-city-picker .trigger-name')).toContainText('ÖRNEK');
  await expect(page.locator('iv-search-page iv-notice.offline-note')).toBeVisible();
  const search = page.locator('iv-search-page ion-searchbar input');
  await search.fill('orn-2');
  const card = page.locator('iv-search-page .results iv-line-card', { hasText: 'ORN-2' });
  await expect(card).toBeVisible();
  await expect(page.locator('iv-search-page .results iv-line-card')).toHaveCount(1);
  await expect(page.locator('iv-search-page .results iv-state')).toHaveCount(0);
  await shoot(page, 'ara-offline-pack', page.locator('iv-search-page iv-notice.offline-note'));

  // Line page from the pack, with the map drawing the route from cached map files.
  await card.locator('button.main').click();
  await expect(page).toHaveURL(/\/hat\/ornek-hat-2\?city=ornek-test-sehri/);
  await expect(page.locator('iv-line-page h1')).toContainText('ORN-2');
  await expect(page.locator('iv-line-page .from-pack')).toContainText('şehir paketinden');
  const map = page.locator('iv-line-page iv-map');
  await expect(map).toHaveAttribute('data-status', /^(ready|no-basemap)$/, { timeout: 30_000 });
  await expect(page.locator('iv-line-page iv-map canvas.maplibregl-canvas')).toBeVisible();
  await shoot(page, 'hat-offline-pack');

  // Favourites still toggle locally (guest favourites in Preferences).
  const star = page.locator('iv-line-page button.star');
  await expect(star).toHaveAttribute('aria-pressed', 'false');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');
  const stored = await page.evaluate(() => localStorage.getItem('CapacitorStorage.iv.favorites'));
  expect(stored).toContain('ornek-hat-2');
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'false');

  // The planner stays online-only and offers the pack's lines instead.
  await page.goto('/planla');
  // Stop suggestions come from the pack while offline.
  await page.locator('#iv-plan-from').fill('durak 1-1');
  await page.locator('[data-end="from"] .suggestions li button').first().click();
  await page.locator('#iv-plan-to').fill('durak 3-3');
  await page.locator('[data-end="to"] .suggestions li button').first().click();
  await page.getByRole('button', { name: 'Rota bul' }).click();
  await expect(page.locator('iv-plan-page iv-state.iv-state--offline')).toContainText('paketten');
  await shoot(page, 'planla-offline-pack', page.locator('iv-plan-page iv-state.iv-state--offline'));

  expect(catalogRequests).toEqual([]);
  await context.setOffline(false);
  const unexpected = consoleErrors.filter(
    (text) =>
      !/401|Failed to load resource|ERR_INTERNET_DISCONNECTED|tiles\.inecekvar\.app/.test(text),
  );
  expect(unexpected).toEqual([]);
});
