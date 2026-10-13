import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { join } from 'node:path';

const CITY = 'ornek-test-sehri';
const SHOTS = join(__dirname, '../../../docs/screenshots/phase3');

async function privateReadToken(request: APIRequestContext): Promise<string> {
  const api = `${process.env['IV_E2E_API'] ?? 'http://127.0.0.1:57980'}/v1`;
  const mail = process.env['IV_E2E_MAIL'] ?? 'http://127.0.0.1:57825';
  const email = `offline${Date.now().toString(36)}@example.com`;
  const password = 'offline-pack-2026!';
  const registered = await request.post(`${api}/auth/register`, {
    data: { email, password, mode: 'bearer' },
  });
  expect(registered.status()).toBe(202);
  let token: string | undefined;
  await expect
    .poll(
      async () => {
        const search = await request.get(`${mail}/api/v1/search`, {
          params: { query: `to:"${email}"` },
        });
        const messages = ((await search.json()) as { messages?: { ID: string }[] }).messages;
        const id = messages?.[0]?.ID;
        if (!id) return false;
        const message = await request.get(`${mail}/api/v1/message/${id}`);
        const text = ((await message.json()) as { Text: string }).Text;
        token = /#token=([A-Za-z0-9_-]+)/.exec(text)?.[1];
        return !!token;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  const verified = await request.post(`${api}/auth/magic-link/verify`, {
    data: { token, password, mode: 'bearer' },
  });
  expect(verified.status()).toBe(200);
  return ((await verified.json()) as { access_token: string }).access_token;
}

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

/**
 * True once the service worker holds every app-shell file. The Angular worker fills its caches
 * after activation, so a worker registered late may control the page before the shell is stored.
 */
function appShellCached(page: Page) {
  return page.waitForFunction(
    async () => {
      const manifest = (await (await fetch('/ngsw.json', { cache: 'no-store' })).json()) as {
        assetGroups: { name: string; urls: string[] }[];
      };
      const wanted = manifest.assetGroups.find((group) => group.name === 'app-shell')?.urls ?? [];
      const stored = new Set<string>();
      for (const name of await caches.keys()) {
        if (!name.startsWith('ngsw:') || !name.includes(':app-shell:')) continue;
        const cache = await caches.open(name);
        for (const request of await cache.keys()) stored.add(new URL(request.url).pathname);
      }
      return wanted.length > 0 && wanted.every((url) => stored.has(url));
    },
    null,
    { timeout: 60_000, polling: 500 },
  );
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
  // The strip diagram is the default view; the map opens with the Harita switch.
  await expect(page.locator('iv-line-page iv-route-strip circle.node')).toHaveCount(5);
  await page.getByRole('button', { name: 'Harita', exact: true }).click();
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

test('recovers map warmup for a pack installed before service worker control', async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    const register = ServiceWorkerContainer.prototype.register;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    Object.defineProperty(window, 'ivAllowServiceWorkerRegistration', { value: release });
    ServiceWorkerContainer.prototype.register = function (url, options) {
      return gate.then(() => register.call(this, url, options));
    };
  });
  await page.goto('/ayarlar/cevrimdisi');
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
  const row = page.locator(`li.city[data-city="${CITY}"]`);
  await row.getByRole('button', { name: 'İndir' }).click();
  await expect(row).toHaveAttribute('data-state', 'installed', { timeout: 30_000 });
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(false);
  await page.evaluate(() => {
    (
      window as unknown as { ivAllowServiceWorkerRegistration(): void }
    ).ivAllowServiceWorkerRegistration();
  });
  await controlledByServiceWorker(page);
  await appShellCached(page);
  await mapAssetsCached(page);
  await context.setOffline(true);
  await page.goto(`/hat/ornek-hat-2?city=${CITY}`);
  await expect(page.locator('iv-line-page .from-pack')).toContainText('şehir paketinden');
  await expect(page.locator('iv-line-page iv-route-strip circle.node')).toHaveCount(5);
  await page.getByRole('button', { name: 'Harita', exact: true }).click();
  await expect(page.locator('iv-line-page iv-map canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('iv-line-page iv-map')).toHaveAttribute(
    'data-status',
    /^(ready|no-basemap)$/,
  );
  await context.setOffline(false);
});

test('never caches an authenticated private query containing a catalog pathname', async ({
  page,
  request,
}) => {
  const token = await privateReadToken(request);
  await page.goto('/ara');
  await controlledByServiceWorker(page);
  const result = await page.evaluate(async (access) => {
    const path = '/api/v1/me?x=/api/v1/lines';
    const response = await fetch(path, {
      headers: { Authorization: `Bearer ${access}` },
      credentials: 'omit',
    });
    await response.text();
    const cached: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith('ngsw:')) continue;
      for (const entry of await (await caches.open(name)).keys()) {
        if (new URL(entry.url).pathname === '/api/v1/me') cached.push(entry.url);
      }
    }
    return { status: response.status, cached };
  }, token);
  expect(result.status).toBe(200);
  expect(result.cached).toEqual([]);
});

test('picks a planner endpoint at the map centre with the keyboard', async ({ page }) => {
  await page.goto('/planla');
  await page.evaluate((city) => localStorage.setItem('CapacitorStorage.iv.city', city), CITY);
  await page.reload();
  await page.getByRole('button', { name: 'Haritadan seç' }).first().click();
  const pick = page.getByRole('button', { name: 'Harita merkezini seç' });
  await expect(pick).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('iv-plan-page iv-map .iv-map-crosshair')).toBeVisible();
  await shoot(page, 'planla-map-pick', page.locator('iv-plan-page iv-map'));
  await pick.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('iv-plan-page iv-map .iv-map-announcement')).not.toBeEmpty();
});
