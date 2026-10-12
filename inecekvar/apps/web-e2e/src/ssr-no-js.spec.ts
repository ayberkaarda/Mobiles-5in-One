import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: false });

test('home content, metadata and structured data work without JavaScript', async ({ page }) => {
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  const heading = page.getByRole('heading', { level: 1, name: 'İnecek Var', exact: true });
  await expect(heading).toBeVisible();
  await expect(page.locator('.tagline')).toHaveText('Dolmuş nereden geçer? Mahalle bilir.');
  await expect(page).toHaveTitle(/^(?:İnecek Var|.+ \| İnecek Var)$/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'http://127.0.0.1:57992/',
  );
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /\S/);
  for (const language of ['tr-TR', 'x-default']) {
    await expect(page.locator(`link[rel="alternate"][hreflang="${language}"]`)).toHaveAttribute(
      'href',
      'http://127.0.0.1:57992/',
    );
  }
  const blocks = page.locator('script[type="application/ld+json"]');
  await expect(blocks).toHaveCount(1);
  const text = (await blocks.textContent()) ?? '';
  expect(text).not.toContain('<');
  const data = JSON.parse(text) as Record<string, unknown>;
  expect(data['@context']).toBe('https://schema.org');
  expect(data['@graph']).toEqual([
    { '@type': 'Organization', name: 'İnecek Var', url: 'http://127.0.0.1:57992/' },
    { '@type': 'WebSite', name: 'İnecek Var', url: 'http://127.0.0.1:57992/' },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'İnecek Var', item: 'http://127.0.0.1:57992/' },
      ],
    },
  ]);
  await expect(page.getByRole('link', { name: /İstanbul/ })).toHaveAttribute('href', '/istanbul');
});

test('missing page has 404, noindex and a keyboard reachable home link', async ({ page }) => {
  const response = await page.goto('/olmayan-sayfa');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1, name: 'Sayfa bulunamadı' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /\bnoindex\b/);
  const home = page.getByRole('link', { name: 'Ana sayfaya dön' });
  await expect(home).toHaveAttribute('href', '/');
  await page.keyboard.press('Tab');
  await expect(home).toBeFocused();
});

test('service status resolves internal health without JavaScript', async ({ page }) => {
  const response = await page.goto('/durum');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'Hizmet çalışıyor' })).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /\bnoindex\b/);
});

test('an unreachable API returns a noindex 503 within ten seconds', async ({ page }) => {
  const start = performance.now();
  const response = await page.goto('http://127.0.0.1:57994/durum', {
    waitUntil: 'domcontentloaded',
    timeout: 10_000,
  });
  expect(response?.status()).toBe(503);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Şu anda yanıt veremiyoruz' }),
  ).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /\bnoindex\b/);
  expect(performance.now() - start).toBeLessThan(10_000);
});
