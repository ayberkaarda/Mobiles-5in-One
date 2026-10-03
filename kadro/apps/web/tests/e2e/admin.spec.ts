import { expect, test } from '@playwright/test';

import { e2eState, signIn, stepUp, totpCode, waitForFreshStep, watchPage } from './support/helpers';

/**
 * Staff panel end to end (security checklist item 18, ADR-0068) in installed Chrome against the
 * production build: headers, sign-in, TOTP step-up and enrollment, venue verification, user role
 * and ban changes with a fresh code, the venue import request and the audit log.
 */

test.describe.configure({ mode: 'serial' });

test('admin pages: nonce CSP on every script, noindex, no-store, no referrer', async ({
  request,
}) => {
  const { baseUrl } = e2eState();
  const response = await request.get(`${baseUrl}/admin/giris`);
  expect(response.status()).toBe(200);
  const headers = response.headers();
  const csp = headers['content-security-policy'] ?? '';
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(csp)?.[1];
  expect(nonce).toBeDefined();
  expect(csp).toContain("'strict-dynamic'");
  expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(csp).toContain("frame-ancestors 'none'");
  expect(headers['x-robots-tag']).toBe('noindex, nofollow');
  expect(headers['cache-control']).toBe('no-store');
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-frame-options']).toBe('DENY');

  const html = await response.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
  expect(scripts.length).toBeGreaterThan(0);
  for (const tag of scripts) {
    expect(tag).toContain(`nonce="${nonce ?? ''}"`);
  }
  expect(html).toMatch(/<meta name="robots" content="noindex, nofollow"/);

  const anonymous = await request.get(`${baseUrl}/admin/sahalar`, { maxRedirects: 0 });
  expect([303, 307, 308]).toContain(anonymous.status());
  expect(anonymous.headers().location).toMatch(/\/admin\/giris$/);
});

test('a player signs in but gets no panel and no admin API', async ({ page }) => {
  const { accounts, baseUrl } = e2eState();
  const watch = watchPage(page);
  await signIn(page, accounts.player);
  await expect(page.getByText('Bu alan yalnızca yetkili ekip içindir.')).toBeVisible();

  const cookies = await page.context().cookies(baseUrl);
  const session = cookies.find((cookie) => cookie.name.startsWith('__Host-') && cookie.httpOnly);
  expect(session).toBeDefined();
  expect(session?.secure).toBe(true);
  expect(session?.sameSite).toBe('Lax');
  expect(session?.path).toBe('/');

  const api = await page.request.get(`${baseUrl}/api/v1/admin/users`, {
    headers: { 'x-kadro-client': 'web' },
  });
  expect(api.status()).toBe(403);
  watch.assertClean();
});

test('a moderator needs the step-up, then sees only moderator sections', async ({ page }) => {
  const { accounts, baseUrl } = e2eState();
  const moderator = accounts.moderator;
  const watch = watchPage(page);
  await signIn(page, moderator);

  // Without a step-up window every panel page leads back to the code form.
  await page.goto(`${baseUrl}/admin/kullanicilar`);
  await page.waitForURL(`${baseUrl}/admin/dogrulama`);

  await page.getByLabel('Doğrulama kodu').fill('000000');
  await page.getByRole('button', { name: 'Doğrula' }).click();
  await expect(page.getByRole('status').first()).toContainText('Kod hatalı');

  await waitForFreshStep(10);
  await stepUp(page, totpCode(moderator.totpSecret ?? ''));

  const nav = page.getByRole('navigation', { name: 'Yönetim bölümleri' });
  await expect(nav.getByRole('link', { name: 'Saha onayı' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: 'Denetim kaydı' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Saha içe aktarma' })).toHaveCount(0);

  await page.goto(`${baseUrl}/admin/denetim`);
  await expect(page.getByText('Bu bölüm için yetkin yok.')).toBeVisible();

  await page.goto(`${baseUrl}/admin/kullanicilar`);
  await expect(page.getByRole('cell', { name: /Hedef Oyuncu/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Engelle' })).toHaveCount(0);
  watch.assertClean();
});

test('an admin verifies a venue and finds it in the audit log', async ({ page }) => {
  const { accounts, baseUrl, venueNames } = e2eState();
  const admin = accounts.venueAdmin;
  const venue = venueNames[0] ?? '';
  const watch = watchPage(page);
  await signIn(page, admin);
  await waitForFreshStep(10);
  await stepUp(page, totpCode(admin.totpSecret ?? ''));

  const row = page.getByRole('row', { name: venue });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: `${venue}: onayla` }).click();
  await expect(page.getByRole('row', { name: venue })).toHaveCount(0);

  await page.goto(`${baseUrl}/admin/sahalar?verified=true`);
  await expect(page.getByRole('row', { name: venue })).toContainText('Onaylı');

  await page.goto(`${baseUrl}/admin/denetim?action=venue.verified`);
  const entry = page.locator('tr[data-audit-action="venue.verified"]');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText('Saha Yöneticisi');
  await expect(entry).toContainText('Saha onaylandı');
  await expect(page.getByText(/ip_?hash/i)).toHaveCount(0);
  watch.assertClean();
});

test('an admin changes a role and bans a user, each with a fresh code', async ({ page }) => {
  const { accounts, baseUrl } = e2eState();
  const admin = accounts.userAdmin;
  const target = accounts.target;
  const watch = watchPage(page);
  await signIn(page, admin);
  // Three codes from one ±1 window: the step-up, the role change and the ban.
  await waitForFreshStep(25);
  const secret = admin.totpSecret ?? '';
  const codes = [totpCode(secret, -1), totpCode(secret, 0), totpCode(secret, 1)];
  await stepUp(page, codes[0] ?? '');

  await page.goto(`${baseUrl}/admin/kullanicilar?q=Hedef`);
  const row = page.locator(`tr[data-user-id="${target.id}"]`);
  await expect(row).toContainText(target.displayName);
  await expect(row).not.toContainText(target.email);

  await row.getByLabel('Rol').selectOption('moderator');
  await row.getByRole('button', { name: 'Rolü değiştir' }).click();
  await row.getByLabel('Onay kodu').fill('123456');
  await row.getByRole('button', { name: 'Onayla' }).click();
  await expect(row.getByRole('status')).toContainText('Kod hatalı');
  await row.getByLabel('Onay kodu').fill(codes[1] ?? '');
  await row.getByRole('button', { name: 'Onayla' }).click();
  await expect(row.getByTestId('user-role')).toHaveText('Moderatör');

  await row.getByRole('button', { name: 'Engelle' }).click();
  await row.getByLabel('Onay kodu').fill(codes[2] ?? '');
  await row.getByRole('button', { name: 'Onayla' }).click();
  await expect(row.getByTestId('user-state')).toHaveText('Engelli');

  const self = page.locator(`tr[data-user-id="${admin.id}"]`);
  await page.goto(`${baseUrl}/admin/kullanicilar?q=Kullan`);
  await expect(self).toContainText('Kendi hesabın');
  watch.assertClean();
});

test('an admin uploads a venue CSV and lands on its status page', async ({ page }) => {
  const { accounts, baseUrl } = e2eState();
  const admin = accounts.importAdmin;
  const watch = watchPage(page);
  await signIn(page, admin);
  await waitForFreshStep(10);
  await stepUp(page, totpCode(admin.totpSecret ?? ''));

  await page.goto(`${baseUrl}/admin/sahalar/ice-aktar`);
  const csv = [
    'name,il,ilce,latitude,longitude,indoor',
    'Ege Spor Kompleksi,izmir,bornova,38.46,27.22,false',
  ].join('\n');
  await page.getByLabel('CSV dosyası').setInputFiles({
    name: 'sahalar.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await expect(page.getByLabel(/Deneme çalıştırması/)).toBeChecked();
  await page.getByRole('button', { name: 'Dosyayı doğrula' }).click();
  await page.waitForURL(/\/admin\/sahalar\/ice-aktar\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('import-status')).toHaveText(/Sırada|İşleniyor|Tamamlandı/);
  await expect(page.getByText('Deneme çalıştırması: satırlar yalnızca doğrulanır')).toBeVisible();

  await page.goto(`${baseUrl}/admin/denetim?action=venue.importRequested`);
  await expect(page.locator('tr[data-audit-action="venue.importRequested"]')).toHaveCount(1);
  watch.assertClean();
});

test('a new moderator enrolls TOTP from a locally drawn QR code and steps up', async ({ page }) => {
  const { accounts, baseUrl } = e2eState();
  const moderator = accounts.unenrolledModerator;
  const watch = watchPage(page);
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseUrl)) {
      external.push(request.url());
    }
  });
  await signIn(page, moderator);
  await page.getByLabel('Doğrulama kodu').fill('123456');
  await page.getByRole('button', { name: 'Doğrula' }).click();
  await expect(page.getByRole('status').first()).toContainText('kurulmamış');

  await page.getByRole('link', { name: 'Doğrulama uygulamasını kur' }).click();
  await page.waitForURL(`${baseUrl}/admin/totp-kurulum`);
  await page.getByLabel('Şifre', { exact: true }).fill(moderator.password);
  await page.getByRole('button', { name: 'Kurulumu başlat' }).click();

  const qr = page.getByRole('img', { name: 'Doğrulama uygulaması için QR kodu' });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((node) => node.tagName.toLowerCase())).toBe('svg');
  const secret = (await page.getByTestId('totp-secret').innerText()).replace(/\s+/g, '');
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);

  await waitForFreshStep(15);
  await page.getByLabel('Uygulamadaki kod').fill(totpCode(secret, 0));
  await page.getByRole('button', { name: 'Kurulumu tamamla' }).click();
  await page.waitForURL(`${baseUrl}/admin/dogrulama`);
  // The confirming code's step is spent; the next step of the window opens the session.
  await stepUp(page, totpCode(secret, 1));
  await expect(page.getByRole('heading', { name: 'Saha onayı' })).toBeVisible();

  expect(external).toEqual([]);
  watch.assertClean();
});
