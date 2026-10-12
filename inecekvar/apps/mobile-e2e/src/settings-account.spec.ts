import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { join } from 'node:path';

/**
 * Settings, the Plus paywall on the web and in-app account deletion against the running API
 * (ADR-0026, ADR-0036). The account is registered through the API with the mailed link (Mailpit),
 * then signed in through the sign-in page in cookie mode; deletion re-authenticates with the
 * password. Environment: IV_E2E_API, IV_E2E_MAIL.
 */
const SHOTS = join(__dirname, '../../../docs/screenshots/phase3');
const API = (process.env['IV_E2E_API'] ?? 'http://127.0.0.1:57980') + '/v1';
const MAIL = process.env['IV_E2E_MAIL'] ?? 'http://127.0.0.1:57825';
const PASSWORD = 'minibus-hatti-2026!';
const EMAIL = `silme${Date.now().toString(36)}@example.com`;

test.use({ serviceWorkers: 'block' });

async function shoot(page: Page, name: string, focus?: Locator): Promise<void> {
  if (focus) await focus.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

async function mailedToken(request: APIRequestContext, to: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await request.get(`${MAIL}/api/v1/search`, { params: { query: `to:"${to}"` } });
    const messages = ((await search.json()) as { messages?: { ID: string }[] }).messages ?? [];
    if (messages.length > 0) {
      const message = await request.get(`${MAIL}/api/v1/message/${messages[0]?.ID}`);
      const token = /#token=([A-Za-z0-9_-]+)/.exec(((await message.json()) as { Text: string }).Text);
      if (token?.[1]) return token[1];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('no magic link mail arrived');
}

test('shows settings and the web paywall, then deletes the account with re-authentication', async ({
  page,
  request,
}) => {
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  // An account opened through the API (the registration link verified with its password).
  expect(
    (
      await request.post(`${API}/auth/register`, {
        data: { email: EMAIL, password: PASSWORD, mode: 'bearer' },
      })
    ).status(),
  ).toBe(202);
  const token = await mailedToken(request, EMAIL);
  expect(
    (
      await request.post(`${API}/auth/magic-link/verify`, {
        data: { token, mode: 'bearer', password: PASSWORD },
      })
    ).status(),
  ).toBe(200);

  // Guests: the paywall says the web stays free and sells nothing.
  await page.goto('/plus');
  await expect(page.locator('iv-notice[data-state="web"]')).toContainText('Android ve iOS');
  await expect(page.getByRole('button', { name: 'Satın al' })).toHaveCount(0);
  await shoot(page, 'plus-web');

  // Sign in with the password in cookie mode, then a ride draft left on the device.
  await page.goto('/giris?sonra=%2Fayarlar');
  await page.locator('#iv-signin-email').fill(EMAIL);
  await page.locator('#iv-signin-password').fill(PASSWORD);
  await page.locator('iv-signin-page button[type="submit"]').click();
  await expect(page).toHaveURL(/\/ayarlar$/);
  await expect(page.locator('[data-account="signed-in"]')).toContainText(EMAIL);
  await expect(page.locator('[data-fact="role"]')).toHaveText('Kullanıcı');
  await expect(page.locator('[data-fact="reputation"]')).toHaveText('0');
  await shoot(page, 'ayarlar-hesap', page.locator('[data-account="signed-in"]'));

  // The English copy of the same page.
  await page.locator('[data-value="en"]').click();
  await expect(page.locator('iv-settings-page h1')).toHaveText('Settings');
  await shoot(page, 'ayarlar-en');
  await page.locator('[data-value="tr"]').click();
  await expect(page.locator('iv-settings-page h1')).toHaveText('Ayarlar');

  // Deletion: explained, confirmed, a wrong password first (the session stays), then the right one.
  await page.getByRole('button', { name: 'Hesabı sil' }).click();
  const form = page.locator('form[data-view="delete"]');
  await expect(form).toContainText('silinmiş katkıcı');
  await expect(form.locator('button[type="submit"]')).toBeDisabled();
  await form.locator('[data-field="confirm"]').check();
  await form.locator('#iv-delete-password').fill('yanlis-sifre-0000');
  await form.locator('button[type="submit"]').click();
  await expect(form.locator('[data-state="error"]')).toContainText('Şifre doğru değil');
  await expect(page.locator('[data-account="signed-in"]')).toBeVisible();
  await shoot(page, 'ayarlar-silme', form);

  const deletion = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/me') && r.request().method() === 'DELETE' && r.ok(),
  );
  await form.locator('#iv-delete-password').fill(PASSWORD);
  await form.locator('button[type="submit"]').click();
  expect((await deletion).status()).toBe(202);
  await expect(page.locator('[data-view="deleted"]')).toBeVisible();
  await expect(page.locator('[data-account="guest"]')).toBeVisible();
  await shoot(page, 'ayarlar-silindi', page.locator('[data-view="deleted"]'));

  // Nothing of the account is left in web storage, and the session is gone on the server.
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(PASSWORD);
  expect(stored).not.toContain(EMAIL);
  expect(stored).not.toContain('iv.trace-draft');
  const me = await page.evaluate(async () => (await fetch('/api/v1/me')).status);
  expect(me).toBe(401);

  const unexpected = consoleErrors.filter(
    (text) => !/401|tiles\.inecekvar\.app|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(text),
  );
  expect(unexpected).toEqual([]);
});
