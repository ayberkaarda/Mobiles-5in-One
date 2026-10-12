import { expect, test } from '@playwright/test';
import { codePoints, HOSTILE_PATH, LINE_PATH, STOP_PATH, TEST_ORIGIN, wordCount } from './support';

test.use({ javaScriptEnabled: false });

test('line page content, metadata and links render without JavaScript', async ({ page }) => {
  const mapRequests: string[] = [];
  page.on('request', (request) => {
    if (/maplibre|pmtiles/i.test(request.url())) mapRequests.push(request.url());
  });
  const response = await page.goto(LINE_PATH);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Kadıköy–Bostancı minibüs hattı',
  );

  const summary = (await page.locator('.summary').textContent()) ?? '';
  expect(wordCount(summary)).toBeGreaterThanOrEqual(40);
  expect(wordCount(summary)).toBeLessThanOrEqual(60);
  expect(summary).toContain('son güncelleme');

  const paths = page.locator('main svg path');
  expect(await paths.count()).toBeGreaterThan(0);
  for (const d of await paths.evaluateAll((nodes) => nodes.map((n) => n.getAttribute('d')))) {
    expect(d).toMatch(/^M [-0-9. ]+( L [-0-9. ]+)*$/);
  }
  await expect(page.locator('main svg circle')).toHaveCount(5);

  const stops = page.locator('main ol li a');
  await expect(stops).toHaveText([
    'Kadıköy Rıhtım',
    'Moda',
    'Fenerbahçe',
    'Suadiye',
    'Bostancı İskele',
  ]);
  await expect(stops.first()).toHaveAttribute('href', '/istanbul/durak/kadikoy-rihtim');

  const facts = page.locator('main dl');
  await expect(facts).toContainText('son güncelleme: 30 Eylül 2026');
  await expect(facts).toContainText('İstanbulkart');
  await expect(facts).not.toContainText('bilinmeyen');
  await expect(facts).toContainText('Son doğrulama');

  await expect(page.getByRole('link', { name: 'Bu hattı düzelt' })).toHaveAttribute(
    'href',
    'https://app.inecekvar.app/katki?hat=kadikoy-bostanci&city=istanbul',
  );
  await expect(page.getByRole('link', { name: 'Uygulamada aç' })).toHaveAttribute(
    'href',
    'https://app.inecekvar.app/hat/kadikoy-bostanci?city=istanbul',
  );
  await expect(page.getByRole('button', { name: 'Haritayı etkileşimli aç' })).toBeVisible();

  const title = await page.title();
  expect(codePoints(title)).toBeLessThanOrEqual(60);
  expect(title).toMatch(/ \| İnecek Var$/);
  const description =
    (await page.locator('meta[name="description"]').getAttribute('content')) ?? '';
  expect(codePoints(description)).toBeGreaterThan(0);
  expect(codePoints(description)).toBeLessThanOrEqual(155);
  const url = TEST_ORIGIN + LINE_PATH;
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', url);
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', url);
  for (const language of ['tr-TR', 'x-default']) {
    await expect(page.locator(`link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute(
      'href',
      url,
    );
  }
  await expect(page.locator('link[hreflang="en"]')).toHaveCount(0);
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    TEST_ORIGIN + '/og/istanbul/hat/kadikoy-bostanci.svg',
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index,/);
  expect(mapRequests).toEqual([]);
});

test('stored markup in line data renders as text', async ({ page }) => {
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const response = await page.goto(HOSTILE_PATH);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(
    'Hat </script><script>alert(1)</script>',
  );
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
  await expect(page.locator('main b')).toHaveCount(0);
  await expect(page.locator('main script')).toHaveCount(0);
  await expect(page.getByRole('link', { name: '<img src=x onerror=alert(1)>' })).toBeVisible();
  await expect(page.locator('main dl')).toContainText('<b>kalın değil</b>');
  expect(dialogs).toEqual([]);
});

test('city hub, line list and stop pages render their data', async ({ page }) => {
  const hub = await page.goto('/istanbul');
  expect(hub?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'İstanbul dolmuş ve minibüs hatları',
  );
  await expect(page.getByRole('heading', { name: 'Popüler hatlar' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Son güncellenen hatlar' })).toBeVisible();
  await expect(page.locator('main')).toContainText('56');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index,/);

  const list = await page.goto('/istanbul/hatlar');
  expect(list?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('İstanbul hat listesi');
  await expect(page.locator('main a[href^="/istanbul/hat/"]')).toHaveCount(50);

  const stop = await page.goto(STOP_PATH);
  expect(stop?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Moda durağı');
  await expect(page.locator('main a[href="/istanbul/hat/kadikoy-bostanci"]')).toBeVisible();
  await expect(page.locator('main a[href="/istanbul/hat/kotu-isim"]')).toBeVisible();
});

test('an empty city and a sample city are rendered but not indexed', async ({ page }) => {
  const empty = await page.goto('/bos-sehir');
  expect(empty?.status()).toBe(200);
  await expect(page.locator('main')).toContainText('Bu şehirde henüz yayımlanmış hat yok.');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /\bnoindex\b/);

  const sample = await page.goto('/ornek-test-sehri');
  expect(sample?.status()).toBe(200);
  await expect(page.locator('main')).toContainText('Bu şehirdeki veriler örnek veridir.');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /\bnoindex\b/);
  const sampleLine = await page.goto('/ornek-test-sehri/hat/ornek-hat-1');
  expect(sampleLine?.status()).toBe(200);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /\bnoindex\b/);
});
