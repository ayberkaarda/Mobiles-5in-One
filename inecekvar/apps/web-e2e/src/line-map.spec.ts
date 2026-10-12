import { expect, test } from '@playwright/test';
import { LINE_PATH } from './support';

test.use({ javaScriptEnabled: true });

const isMapRequest = (url: string) => /maplibre|pmtiles/i.test(url);

test('home and city hub never load the map code', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  for (const path of ['/', '/istanbul']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  }
  expect(requests.filter(isMapRequest)).toEqual([]);
});

test('the interactive map loads only after a click and without CSP violations', async ({
  page,
}) => {
  const requests: string[] = [];
  const messages: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('console', (message) => messages.push(message.text()));
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto(LINE_PATH);
  await page.waitForLoadState('networkidle');
  expect(requests.filter(isMapRequest)).toEqual([]);
  const before = requests.length;

  await page.getByRole('button', { name: 'Haritayı etkileşimli aç' }).click();
  const canvas = page.locator('.iv-line-map-surface canvas');
  const failure = page.getByText('Harita açılamadı.');
  await expect(canvas.or(failure)).toBeVisible({ timeout: 20_000 });
  const outcome = (await canvas.count()) > 0 ? 'map canvas rendered' : 'map failed to start';
  test.info().annotations.push({ type: 'map', description: outcome });

  const loaded = requests.slice(before);
  expect(loaded.some((url) => /\.m?js(\?|$)/.test(url))).toBe(true);
  if (outcome === 'map canvas rendered') {
    expect(loaded.some((url) => url.includes('maplibre/maplibre-gl-worker.mjs'))).toBe(true);
  }
  const violations = messages.filter((message) =>
    /Content Security Policy|Refused to/i.test(message),
  );
  expect(violations).toEqual([]);
  expect(errors).toEqual([]);
});
