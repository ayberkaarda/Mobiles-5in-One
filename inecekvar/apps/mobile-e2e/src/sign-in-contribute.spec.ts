import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Sign-in and contributor tools against the running API (ADR-0035): registration with the
 * mailed link (read from Mailpit), the licence dialog, a recorded ride with a marked stop, a
 * fare proposal with a photo through the presigned upload, and the proposal list after a
 * moderator decision. Environment: IV_E2E_API (API origin), IV_E2E_MAIL (Mailpit web origin),
 * IV_E2E_PSQL_CONTAINER (Postgres container used to give the second account the moderator
 * role; without it the moderation step is skipped). The approval publishes a new line
 * version, so this file runs after the pack scenario (which expects the seeded version 0).
 */
const CITY = 'ornek-test-sehri';
const SHOTS = join(__dirname, '../../../docs/screenshots/phase3');
const API = (process.env['IV_E2E_API'] ?? 'http://127.0.0.1:57980') + '/v1';
const MAIL = process.env['IV_E2E_MAIL'] ?? 'http://127.0.0.1:57825';
const PSQL = process.env['IV_E2E_PSQL_CONTAINER'];
const PASSWORD = 'dolmus-durak-2026!';
const stamp = Date.now();
const EMAIL = `katki${stamp.toString(36)}@example.com`;
const MODERATOR = `mod${stamp.toString(36)}@example.com`;

test.use({
  serviceWorkers: 'block',
  permissions: ['geolocation'],
  geolocation: { latitude: 42.511, longitude: 34.012, accuracy: 5 },
});

async function shoot(page: Page, name: string, focus?: Locator): Promise<void> {
  if (focus) await focus.evaluate((el) => el.scrollIntoView({ block: 'start' }));
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    await page.screenshot({ path: join(SHOTS, `${name}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

/** The newest magic-link token mailed to `to` (Mailpit HTTP API). */
async function mailedToken(request: APIRequestContext, to: string, after = 0): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const search = await request.get(`${MAIL}/api/v1/search`, {
      params: { query: `to:"${to}"` },
    });
    const messages = ((await search.json()) as { messages?: { ID: string }[] }).messages ?? [];
    if (messages.length > after) {
      const message = await request.get(`${MAIL}/api/v1/message/${messages[0]?.ID}`);
      const body = ((await message.json()) as { Text: string }).Text;
      const token = /#token=([A-Za-z0-9_-]+)/.exec(body)?.[1];
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('no magic link mail arrived');
}

/** A JPEG drawn in the page (a little fare board), as a file to upload. */
async function fareBoardJpeg(page: Page): Promise<Buffer> {
  const base64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 420;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    g.fillStyle = '#14213d';
    g.fillRect(0, 0, 640, 420);
    g.fillStyle = '#f2b705';
    g.font = 'bold 44px sans-serif';
    g.fillText('ÜCRET TARİFESİ', 40, 80);
    g.font = '32px sans-serif';
    g.fillStyle = '#fff8e7';
    ['ORN-1  Tam  27,50 TL', 'ORN-1  Öğrenci  20,00 TL'].forEach((line, i) =>
      g.fillText(line, 40, 170 + i * 70),
    );
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b as Blob), 'image/jpeg', 0.85),
    );
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary);
  });
  return Buffer.from(base64, 'base64');
}

/** A second account through the API (bearer mode), promoted to moderator in the database. */
async function moderatorToken(request: APIRequestContext): Promise<string> {
  const registered = await request.post(`${API}/auth/register`, {
    data: { email: MODERATOR, password: PASSWORD, mode: 'bearer' },
  });
  expect(registered.status()).toBe(202);
  const token = await mailedToken(request, MODERATOR);
  const verified = await request.post(`${API}/auth/magic-link/verify`, {
    data: { token, mode: 'bearer', password: PASSWORD },
  });
  expect(verified.status()).toBe(200);
  const access = ((await verified.json()) as { access_token: string }).access_token;
  execFileSync('docker', [
    'exec',
    PSQL as string,
    'psql',
    '-U',
    'inecekvar',
    '-d',
    'inecekvar',
    '-c',
    `update users set role = 'moderator' where email = '${MODERATOR}'`,
  ]);
  return access;
}

test('signs up with the mailed link, records a ride and sends proposals', async ({
  page,
  context,
  request,
}) => {
  test.setTimeout(420_000);
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });

  await page.goto('/ara');
  await page.evaluate((city) => localStorage.setItem('CapacitorStorage.iv.city', city), CITY);

  // Guests are sent to sign in when they open a contributor tool.
  await page.goto('/katki/kayit');
  await expect(page).toHaveURL(/\/giris\?sonra=%2Fkatki%2Fkayit$/);
  await expect(page.locator('iv-signin-page h1')).toHaveText('Giriş yap');
  await page.locator('#iv-signin-email').fill(EMAIL);
  await shoot(page, 'giris');

  // Register; the account opens from the mailed link with the same password.
  await page.getByRole('link', { name: 'Kaydol' }).click();
  await page.locator('#iv-register-email').fill(EMAIL);
  await page.locator('#iv-register-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Hesap oluştur' }).click();
  await expect(page.locator('[data-state="register-sent"]')).toBeVisible();
  expect(page.url()).not.toContain(PASSWORD);

  const token = await mailedToken(request, EMAIL);
  await page.goto(`/giris/baglanti#token=${token}`);
  await expect(page.locator('[data-view="password"]')).toBeVisible();
  // The token left the address bar before anything else ran.
  expect(page.url()).not.toContain('token');
  await page.locator('#iv-link-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Hesabı aç' }).click();
  await expect(page).toHaveURL(/\/katki$/);
  await expect(page.locator('[data-state="signed-in"]')).toContainText(EMAIL);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(PASSWORD);
  expect(stored).not.toContain(token);
  await shoot(page, 'katki');

  // The magic-link form (another device, or a forgotten password).
  await page.goto('/giris');
  await page.getByRole('button', { name: 'E-posta bağlantısıyla' }).click();
  await page.locator('#iv-signin-email').fill(EMAIL);
  await page.getByRole('button', { name: 'Bağlantı gönder' }).click();
  await expect(page.locator('[data-state="link-sent"]')).toBeVisible();
  await shoot(page, 'giris-link-sent');

  // Record a ride along ORN-1 with one marked stop.
  await page.goto('/katki/kayit');
  await expect(page.locator('[data-view="idle"]')).toBeVisible();
  await expect(page.locator('iv-city-picker .trigger-name')).toContainText('ÖRNEK');
  await shoot(page, 'katki-kayit-idle');
  await page.getByRole('button', { name: 'Kaydı başlat' }).click();
  await expect(page.locator('[data-view="recording"]')).toBeVisible();
  for (let i = 0; i < 36; i++) {
    await context.setGeolocation({
      latitude: 42.511 + Math.sin(i / 6) * 0.0012,
      longitude: 34.012 + i * 0.0016,
      accuracy: 6,
    });
    await page.waitForTimeout(60);
    if (i === 14) {
      await page.getByRole('button', { name: 'Durak işaretle' }).click();
      await page.locator('#iv-rec-name').fill('Fırın önü');
      await page.getByRole('button', { name: 'Kaydet' }).click();
    }
  }
  await expect(page.locator('[data-stat="points"]')).toHaveText('36');
  await shoot(page, 'katki-kayit-recording');
  await page.getByRole('button', { name: 'Bitir' }).click();
  await expect(page.locator('[data-view="review"]')).toBeVisible();
  await expect(page.locator('#iv-rec-stop-0')).toHaveValue('Fırın önü');
  await expect(page.locator('iv-recorder-page iv-map')).toHaveAttribute(
    'data-status',
    /^(ready|no-basemap|failed)$/,
    { timeout: 30_000 },
  );
  await shoot(page, 'katki-kayit-review');

  // First submission: the licence dialog, then the upload.
  const traceRequest = page.waitForRequest(
    (r) => r.url().endsWith('/api/v1/traces') && r.method() === 'POST',
  );
  await page.getByRole('button', { name: 'İzi gönder' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Katkıların açık veri olur');
  await shoot(page, 'katki-lisans');
  await dialog.getByRole('button', { name: 'Kabul ediyorum' }).click();
  const sent = (await traceRequest).postDataJSON() as Record<string, unknown>;
  expect(Object.keys(sent).sort()).toEqual(['city', 'ended_at', 'points', 'started_at']);
  expect((sent['points'] as unknown[]).length).toBeLessThanOrEqual(36);
  await expect(page.locator('[data-view="uploaded"]')).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('CapacitorStorage.iv.trace-draft')),
  ).toBeNull();

  // A fare proposal with a photo of the fare table (presigned PUT to object storage).
  await page.goto(`/katki/oneri?tur=fare_update&hat=ornek-hat-1&city=${CITY}`);
  await expect(page.locator('[data-target="line"]')).toContainText('ORN-1');
  // Differs from the seeded fare and, mostly, from a fare approved by an earlier run.
  await page.locator('#iv-fare').fill(`${27 + (stamp % 7)},50`);
  const photoPut = page.waitForRequest(
    (r) => r.method() === 'PUT' && r.url().includes('/incoming/'),
  );
  await page.locator('input[type="file"]').setInputFiles({
    name: 'tarife.jpg',
    mimeType: 'image/jpeg',
    buffer: await fareBoardJpeg(page),
  });
  const put = await photoPut;
  expect(put.headers()['authorization']).toBeUndefined();
  expect(put.headers()['cookie']).toBeUndefined();
  await expect(page.locator('[data-photo="done"]')).toBeVisible();
  await shoot(page, 'katki-oneri', page.locator('iv-proposal-page .iv-page'));
  await shoot(page, 'katki-foto', page.locator('iv-proposal-page fieldset.photo'));

  // The worker takes the photo once its presign window has passed (shortened for this run);
  // the form holds the send button until then, so no attempt is wasted on the daily quota.
  const submit = page.locator('iv-proposal-page button[type="submit"]');
  await expect(submit).toHaveText(/Fotoğraf işleniyor/);
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText(/Öneriyi gönder/, { timeout: 150_000 });
  for (let attempt = 0; attempt < 3; attempt++) {
    await submit.click();
    const outcome = await Promise.race([
      page.waitForURL(/\/katki\/onerilerim\?yeni=1$/, { timeout: 8_000 }).then(() => 'sent'),
      page
        .getByText('Fotoğraf hâlâ işleniyor')
        .waitFor({ timeout: 8_000 })
        .then(() => 'pending'),
    ]).catch(() => 'pending');
    if (outcome === 'sent') break;
    await page.waitForTimeout(20_000);
  }
  await expect(page).toHaveURL(/\/katki\/onerilerim\?yeni=1$/);

  // Two more proposals: an hours update and a new stop.
  await page.goto(`/katki/oneri?tur=update_line&hat=ornek-hat-2&city=${CITY}`);
  await expect(page.locator('[data-target="line"]')).toContainText('ORN-2');
  await page.locator('#iv-hours').fill('06:30-23:30, pazar 08:00-22:00');
  await page.getByRole('button', { name: 'Öneriyi gönder' }).click();
  await expect(page).toHaveURL(/\/katki\/onerilerim\?yeni=1$/);
  await page.goto('/katki/oneri?tur=new_stop');
  await page.locator('#iv-stop-name').fill('Fırın önü');
  await page.getByRole('button', { name: 'Konumumu kullan' }).click();
  await page.getByRole('button', { name: 'Öneriyi gönder' }).click();
  await expect(page).toHaveURL(/\/katki\/onerilerim\?yeni=1$/);

  if (PSQL) {
    const moderator = await moderatorToken(request);
    const headers = { Authorization: `Bearer ${moderator}` };
    const queue = await request.get(`${API}/moderation/edits`, {
      headers,
      params: { state: 'pending' },
    });
    expect(queue.status()).toBe(200);
    const edits = (await queue.json()) as { id: string; kind: string }[];
    const fare = edits.find((e) => e.kind === 'fare_update');
    const stop = edits.find((e) => e.kind === 'new_stop');
    expect(fare && stop).toBeTruthy();
    expect(
      (
        await request.post(`${API}/moderation/edits/${fare?.id}/approve`, { headers, data: {} })
      ).status(),
    ).toBe(200);
    expect(
      (
        await request.post(`${API}/moderation/edits/${stop?.id}/reject`, {
          headers,
          data: { reason: 'Bu durak zaten var: Durak 1-2 ile aynı yer.' },
        })
      ).status(),
    ).toBe(200);
  }

  await page.goto('/katki/onerilerim');
  await expect(page.locator('.list > li')).toHaveCount(3);
  if (PSQL) {
    await expect(page.locator('.list > li[data-state="rejected"] .reason')).toContainText(
      'Bu durak zaten var',
    );
    await expect(page.locator('.list > li[data-state="approved"]')).toHaveCount(1);
  }
  await shoot(page, 'katki-onerilerim');

  const unexpected = consoleErrors.filter(
    (text) => !/401|tiles\.inecekvar\.app|ERR_NAME_NOT_RESOLVED|Failed to load resource/.test(text),
  );
  expect(unexpected).toEqual([]);
});
