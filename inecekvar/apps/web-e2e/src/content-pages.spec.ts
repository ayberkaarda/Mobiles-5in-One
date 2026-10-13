import { expect, test } from '@playwright/test';
import { jsonLdNodes, nodesOfType, TEST_ORIGIN, wordCount } from './support';

test.use({ javaScriptEnabled: false });

const GUIDES = [
  '/rehber/dolmus-ve-minibus-hatti-nasil-okunur',
  '/rehber/istanbul-minibus-dolmus-farki-nasil-binilir',
  '/rehber/durak-yoksa-nereden-inilir-inecek-var',
  '/rehber/cevrimdisi-sehir-paketi-nasil-kullanilir',
  '/rehber/hat-bilgisi-nasil-dogrulanir',
];
const FIXED = [
  '/rehber',
  '/sss',
  '/veri',
  '/veri-lisansi',
  '/hakkinda',
  '/gizlilik',
  '/kvkk-aydinlatma',
  '/hesap-silme',
  '/iletisim',
];

for (const path of GUIDES) {
  test(`guide ${path} renders without JavaScript with Article data`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
    const text = (await page.locator('article').textContent()) ?? '';
    expect(wordCount(text)).toBeGreaterThanOrEqual(600);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', TEST_ORIGIN + path);
    const nodes = await jsonLdNodes(page);
    const articles = nodesOfType(nodes, 'Article');
    expect(articles).toHaveLength(1);
    expect(articles[0]['url']).toBe(TEST_ORIGIN + path);
    expect(articles[0]['headline']).toBe(
      await page.getByRole('heading', { level: 1 }).textContent(),
    );
    const title = await page.title();
    expect(Array.from(title).length).toBeLessThanOrEqual(60);
    expect(title).toMatch(/\| İnecek Var$/);
  });
}

test('/sss shows 15 questions mirrored in FAQPage data', async ({ page }) => {
  const response = await page.goto('/sss');
  expect(response?.status()).toBe(200);
  const questions = await page.locator('article section h2').allTextContents();
  const answers = await page.locator('article section p').allTextContents();
  expect(questions).toHaveLength(15);
  const faq = nodesOfType(await jsonLdNodes(page), 'FAQPage');
  expect(faq).toHaveLength(1);
  const entities = faq[0]['mainEntity'] as {
    name: string;
    acceptedAnswer: { text: string };
  }[];
  expect(entities.map((entity) => entity.name)).toEqual(questions);
  expect(entities.map((entity) => entity.acceptedAnswer.text)).toEqual(answers);
});

test('/veri carries Dataset data and the proposed-licence status', async ({ page }) => {
  await page.goto('/veri');
  await expect(page.locator('.status')).toContainText('hukuki onay bekleniyor');
  await expect(page.locator('code')).toContainText('/export/{sehir}/latest.geojson');
  const datasets = nodesOfType(await jsonLdNodes(page), 'Dataset');
  expect(datasets).toHaveLength(1);
  expect(datasets[0]['license']).toBe(TEST_ORIGIN + '/veri-lisansi');
});

test('draft and thin pages are noindex; the deletion page is indexable and needs JavaScript for its panel', async ({
  page,
}) => {
  for (const path of ['/kvkk-aydinlatma', '/iletisim']) {
    await page.goto(path);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^noindex,follow/);
  }
  await page.goto('/kvkk-aydinlatma');
  await expect(page.locator('.status')).toContainText('Taslak');
  await page.goto('/hesap-silme');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index,follow/);
  // Without JavaScript the server text and the fallback stay; the panel is client-only.
  await expect(page.locator('form, input, button, textarea')).toHaveCount(0);
  await expect(page.locator('.status')).toContainText('web silme panelinden');
  await expect(page.locator('[data-deletion-fallback]')).toContainText('JavaScript gerektirir');
});

test('every internal link on every content page resolves', async ({ page, request }) => {
  const seen = new Set<string>();
  const pending: string[] = [];
  for (const path of [...FIXED, ...GUIDES]) {
    await page.goto(path);
    const hrefs = await page
      .locator('main a[href^="/"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') ?? ''));
    for (const href of hrefs) {
      if (!seen.has(href)) {
        seen.add(href);
        pending.push(href);
      }
    }
  }
  expect(pending.length).toBeGreaterThan(10);
  for (const href of pending) {
    // The home page lists cities from the fake API; every content path must answer 200.
    const response = await request.get(TEST_ORIGIN + href);
    expect(response.status(), href).toBe(200);
  }
});

test('unknown guide is a 404 page', async ({ page }) => {
  const response = await page.goto('/rehber/yok-boyle-bir-rehber');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sayfa bulunamadı');
});

test('llms files are served as UTF-8 plain text', async ({ request }) => {
  for (const path of ['/llms.txt', '/llms-full.txt']) {
    const response = await request.get(TEST_ORIGIN + path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
    const body = await response.text();
    expect(body.startsWith('# İnecek Var')).toBe(true);
    expect(body).toContain('Dolmuş nereden geçer? Mahalle bilir.');
    expect(body).toContain('henüz verilmiş bir lisans yok');
  }
});
