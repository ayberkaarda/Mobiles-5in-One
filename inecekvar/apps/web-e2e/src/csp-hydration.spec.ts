import { expect, test } from '@playwright/test';

test.use({ javaScriptEnabled: true });

const headings: Record<string, string> = {
  '/': 'İnecek Var',
  '/durum': 'Hizmet çalışıyor',
  '/istanbul': 'İstanbul dolmuş ve minibüs hatları',
  '/istanbul/hat/kadikoy-bostanci': 'Kadıköy–Bostancı minibüs hattı',
  '/istanbul/durak/moda': 'Moda durağı',
};

for (const path of Object.keys(headings)) {
  test(`hydrates ${path} without CSP violations or page errors`, async ({ page }) => {
    const messages: string[] = [];
    const errors: string[] = [];
    const healthRequests: string[] = [];
    page.on('console', (message) => messages.push(message.text()));
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/v1/health') {
        healthRequests.push(request.url());
      }
    });
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(headings[path]);
    await expect(page.locator('link[data-beasties-media]')).toHaveCount(0);
    const violations = messages.filter((message) =>
      /Content Security Policy|Refused to/i.test(message),
    );
    expect(violations).toEqual([]);
    expect(errors).toEqual([]);
    expect(healthRequests).toEqual([]);
  });
}
