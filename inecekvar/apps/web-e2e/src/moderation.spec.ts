import { type APIRequestContext, expect, type Locator, type Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { REAL_STACK } from '../stack-env.mjs';
import { TotpDevice } from './totp';

/**
 * Moderation and admin UI against the real local API (ADR-0041): a contributor proposes a fare
 * change and a retirement through the API, a moderator signs in on /admin, approves the fare,
 * enrols TOTP, is refused a rollback without step-up (403) and succeeds after the code, retires
 * a line, and an admin sees the audit rows. Needs `node scripts/real-stack.mjs up` and
 * IV_E2E_REAL_API=1; otherwise the scenario is reported as skipped.
 */
const REAL = process.env['IV_E2E_REAL_API'] === '1';
const PROXY = `http://127.0.0.1:${REAL_STACK.proxyPort}`;
const API = `http://127.0.0.1:${REAL_STACK.apiPort}/v1`;
const CITY = 'ornek-test-sehri';
const PASSWORD = 'dolmus-durak-2026!';
const SHOTS = join(__dirname, '../../../docs/screenshots/phase4');
const stamp = Date.now().toString(36);
const CONTRIBUTOR = `katki-${stamp}@example.com`;
const MODERATOR = `moderator-${stamp}@example.com`;
const ADMIN = `yonetici-${stamp}@example.com`;

test.skip(!REAL, 'needs the real API stack: node scripts/real-stack.mjs up and IV_E2E_REAL_API=1');
test.describe.configure({ mode: 'serial' });

async function shoot(page: Page, name: string, mask: Locator[] = []): Promise<void> {
  mkdirSync(SHOTS, { recursive: true });
  const width = page.viewportSize()?.width ?? 1280;
  for (const size of [1280, 360]) {
    await page.setViewportSize({ width: size, height: size === 360 ? 780 : 860 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: join(SHOTS, `admin-${name}-${size}.png`), fullPage: true, mask });
  }
  await page.setViewportSize({ width, height: 860 });
}

async function mailedToken(request: APIRequestContext, to: string): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    const search = await request.get(`${REAL_STACK.mailUi}/api/v1/search`, {
      params: { query: `to:"${to}"` },
    });
    const messages = ((await search.json()) as { messages?: { ID: string }[] }).messages ?? [];
    if (messages[0]) {
      const message = await request.get(`${REAL_STACK.mailUi}/api/v1/message/${messages[0].ID}`);
      const token = /#token=([A-Za-z0-9_-]+)/.exec(
        ((await message.json()) as { Text: string }).Text,
      )?.[1];
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('no magic link mail arrived');
}

/** Registers through the API (bearer mode) and returns the access token. */
async function account(request: APIRequestContext, email: string): Promise<string> {
  const registered = await request.post(`${API}/auth/register`, {
    data: { email, password: PASSWORD, mode: 'bearer' },
  });
  expect(registered.status()).toBe(202);
  const verified = await request.post(`${API}/auth/magic-link/verify`, {
    data: { token: await mailedToken(request, email), mode: 'bearer', password: PASSWORD },
  });
  expect(verified.status()).toBe(200);
  return ((await verified.json()) as { access_token: string }).access_token;
}

/** Roles are granted by an admin; the first ones come from the database, as in production. */
function grantRole(email: string, role: 'moderator' | 'admin'): void {
  if (!/^[a-z0-9.-]+@example\.com$/.test(email)) throw new Error('unexpected test email');
  execFileSync('docker', [
    'exec',
    `${REAL_STACK.project}-postgres-1`,
    'psql',
    '-U',
    'inecekvar',
    '-d',
    'inecekvar',
    '-v',
    'ON_ERROR_STOP=1',
    '-c',
    `update users set role = '${role}' where email = '${email}'`,
  ]);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto(`${PROXY}/admin`);
  await expect(page).toHaveURL(/\/admin\/giris$/);
  await page.locator('#iv-admin-email').fill(email);
  await page.locator('#iv-admin-password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(page).toHaveURL(/\/admin\/kuyruk$/);
  await expect(page.locator('[data-who="email"]')).toHaveText(email);
}

/** Enrols TOTP on the admin UI; the secret is read from the page as a person would type it. */
async function enrolTotp(page: Page): Promise<TotpDevice> {
  await page.getByRole('link', { name: 'Doğrulama', exact: true }).click();
  await expect(page.locator('[data-totp="disabled"]')).toBeVisible();
  await page.getByRole('button', { name: 'Kurulumu başlat' }).click();
  const secretText = (await page.locator('[data-totp="secret"]').textContent()) ?? '';
  const device = new TotpDevice(secretText.replace(/\s/g, ''));
  await expect(page.locator('svg.qr path')).toHaveAttribute('d', /^(M\d+ \d+h1v1h-1z)+$/);
  expect(page.url()).not.toContain(secretText.replace(/\s/g, '').slice(0, 8));
  await shoot(page, 'totp-enrol', [page.locator('[data-totp="secret"]'), page.locator('svg.qr')]);
  await page.locator('#iv-totp-code').fill(device.next());
  await page.getByRole('button', { name: 'Onayla ve aç' }).click();
  await expect(page.locator('[data-totp="enabled"]')).toBeVisible();
  await expect(page.locator('[data-banner="totp"]')).toHaveCount(0);
  return device;
}

async function expectNoStoredSecrets(page: Page, secrets: string[]): Promise<void> {
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  for (const secret of secrets) expect(stored).not.toContain(secret);
}

/** Every form control on the page has a label (a light check; axe is not in the workspace). */
async function expectLabelledControls(page: Page): Promise<void> {
  const unlabelled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select, textarea'))
      .filter((element) => {
        const control = element as HTMLInputElement;
        return control.labels?.length === 0 && !control.getAttribute('aria-label');
      })
      .map((element) => element.id || element.outerHTML.slice(0, 60)),
  );
  expect(unlabelled).toEqual([]);
}

test('moderation and admin flow against the real API', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.setViewportSize({ width: 1280, height: 860 });

  // A contributor proposes a fare change on ORN-1 and the retirement of ORN-3 through the API.
  const contributor = await account(request, CONTRIBUTOR);
  const auth = { Authorization: `Bearer ${contributor}` };
  expect(
    (await request.post(`${API}/me/licence-accept`, { headers: auth, data: {} })).status(),
  ).toBe(200);
  const line = (await (
    await request.get(`${API}/lines/ornek-hat-1`, { params: { city: CITY } })
  ).json()) as {
    id: string;
    version_no: number;
    fare_minor: number;
  };
  const retired = (await (
    await request.get(`${API}/lines/ornek-hat-3`, { params: { city: CITY } })
  ).json()) as {
    id: string;
  };
  const newFare = line.fare_minor + 250;
  const fareEdit = await request.post(`${API}/edits`, {
    headers: auth,
    data: {
      kind: 'fare_update',
      line: line.id,
      base_version_no: line.version_no,
      fare_minor: newFare,
    },
  });
  expect(fareEdit.status()).toBe(201);
  const retireEdit = await request.post(`${API}/edits`, {
    headers: auth,
    data: { kind: 'retire', line: retired.id, reason: 'Servis artık bu güzergâhta çalışmıyor.' },
  });
  expect(retireEdit.status()).toBe(201);
  const fareId = ((await fareEdit.json()) as { id: string }).id;
  const retireId = ((await retireEdit.json()) as { id: string }).id;

  await account(request, MODERATOR);
  grantRole(MODERATOR, 'moderator');
  await account(request, ADMIN);
  grantRole(ADMIN, 'admin');

  // The moderator signs in on the admin UI (cookie session through the same-origin proxy).
  await page.goto(`${PROXY}/admin`);
  await expect(page).toHaveURL(/\/admin\/giris$/);
  await shoot(page, 'giris');
  await signIn(page, MODERATOR);
  await expect(page.locator('[data-banner="totp"]')).toBeVisible();
  const fareCard = page.locator(`[data-edit="${fareId}"]`);
  await expect(fareCard.locator('[data-field="fare_minor"] td').nth(1)).toContainText(
    String(newFare / 100).replace('.', ','),
  );
  await expect(fareCard.locator('[data-photo]')).toHaveText('Fotoğraf yok.');
  await expect(page.locator(`[data-edit="${retireId}"] [data-field="status"]`)).toContainText(
    'Kaldırıldı',
  );
  await expectLabelledControls(page);
  await shoot(page, 'kuyruk');

  // Approve the fare change.
  await fareCard.getByRole('button', { name: 'Onayla', exact: true }).click();
  await expect(page.getByText('Öneri onaylandı ve yeni sürüm yayımlandı.')).toBeVisible();
  await expect(fareCard).toHaveCount(0);

  // Without TOTP a rollback is refused with the enrolment message.
  await page.getByRole('link', { name: 'Sürümler' }).click();
  await page.locator('#iv-versions-city').selectOption(CITY);
  await page.locator('#iv-versions-q').fill('ORN-1');
  await page.getByRole('button', { name: 'Ara' }).click();
  await page.getByRole('button', { name: /ORN-1/ }).click();
  await expect(page.locator('[data-line] h2')).toContainText('ORN-1');
  const versionOne = page.locator('[data-version="1"]');
  await versionOne.getByRole('button', { name: 'Bu sürüme dön' }).click();
  await page.locator('[data-dialog="confirm"]').getByRole('button', { name: 'Geri al' }).click();
  await expect(page.getByRole('alert')).toContainText('önce iki adımlı doğrulamayı');

  // Enrol TOTP, then the rollback without a step-up answers 403 auth.step_up_required.
  const moderatorDevice = await enrolTotp(page);
  await page.getByRole('link', { name: 'Sürümler' }).click();
  await page.locator('#iv-versions-city').selectOption(CITY);
  await page.locator('#iv-versions-q').fill('ORN-1');
  await page.getByRole('button', { name: 'Ara' }).click();
  await page.getByRole('button', { name: /ORN-1/ }).click();
  await expect(page.locator('[data-line] p')).toContainText(
    `Yayındaki sürüm: ${line.version_no + 1}`,
  );
  await expectLabelledControls(page);
  await shoot(page, 'surumler');
  const refused = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/moderation/lines/${line.id}/rollback`) &&
      response.status() === 403,
  );
  await versionOne.getByRole('button', { name: 'Bu sürüme dön' }).click();
  await expect(page.locator('[data-dialog="confirm"]')).toContainText('sürüm 1 geri yüklensin mi?');
  await shoot(page, 'geri-al-onay');
  await page.locator('[data-dialog="confirm"]').getByRole('button', { name: 'Geri al' }).click();
  const refusal = await refused;
  expect(((await refusal.json()) as { code: string }).code).toBe('auth.step_up_required');
  const dialog = page.locator('[data-dialog="step-up"]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('#iv-stepup-code')).toHaveAttribute('autocomplete', 'one-time-code');
  await shoot(page, 'adim-dogrulama');
  const accepted = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/api/v1/moderation/lines/${line.id}/rollback`) &&
      response.status() === 200,
  );
  const stepUpRequest = page.waitForRequest((r) => r.url().endsWith('/api/v1/auth/step-up'));
  const code = moderatorDevice.next();
  await dialog.locator('#iv-stepup-code').fill(code);
  await dialog.getByRole('button', { name: 'Doğrula' }).click();
  expect((await stepUpRequest).url()).not.toContain(code);
  await accepted;
  await expect(
    page.getByText(`Geri alındı: yeni sürüm ${line.version_no + 2} yayımlandı.`),
  ).toBeVisible();
  await expect(page.locator('[data-banner="step-up"]')).toBeVisible();
  const restored = (await (
    await request.get(`${API}/lines/ornek-hat-1`, { params: { city: CITY } })
  ).json()) as {
    fare_minor: number;
    version_no: number;
  };
  expect(restored).toMatchObject({ fare_minor: line.fare_minor, version_no: line.version_no + 2 });

  // Retire ORN-3 from the queue: confirmation, and the step-up of this session still counts.
  await page.getByRole('link', { name: 'Kuyruk' }).click();
  const retireCard = page.locator(`[data-edit="${retireId}"]`);
  await retireCard.getByRole('button', { name: 'Onayla ve kaldır' }).click();
  await page
    .locator('[data-dialog="confirm"]')
    .getByRole('button', { name: 'Hattı kaldır' })
    .click();
  await expect(page.getByText('Hat kaldırıldı.')).toBeVisible();
  await expect(page.locator('[data-queue="empty"]')).toBeVisible();
  const retiredLine = (await (
    await request.get(`${API}/lines/ornek-hat-3`, { params: { city: CITY } })
  ).json()) as {
    status: string;
  };
  expect(retiredLine.status).toBe('retired');
  await expectNoStoredSecrets(page, [PASSWORD, code]);

  // Moderators see no admin-only screens; the role guard sends them back to the queue.
  await expect(page.getByRole('link', { name: 'Kullanıcılar' })).toHaveCount(0);
  await page.goto(`${PROXY}/admin/kullanicilar`);
  await expect(page).toHaveURL(/\/admin\/kuyruk$/);

  // Sign-out clears everything; the next account starts empty.
  await page.getByRole('button', { name: 'Çıkış' }).click();
  await expect(page).toHaveURL(/\/admin\/giris$/);
  await expect(page.locator('[data-notice="sign-in"]')).toContainText('Çıkış yaptın');
  await expect(page.locator('[data-edit]')).toHaveCount(0);

  // The admin enrols TOTP, then the audit log (step-up) shows the moderation rows.
  await signIn(page, ADMIN);
  await expect(page.locator('[data-banner="step-up"]')).toHaveCount(0);
  const adminDevice = await enrolTotp(page);
  await page.getByRole('link', { name: 'Denetim' }).click();
  await expect(page.locator('[data-dialog="step-up"]')).toBeVisible();
  await page.locator('#iv-stepup-code').fill(adminDevice.next());
  await page.locator('[data-dialog="step-up"]').getByRole('button', { name: 'Doğrula' }).click();
  await expect(page.locator('[data-audit="total"]')).toBeVisible();
  for (const action of [
    'moderation.approve',
    'moderation.rollback',
    'auth.step_up',
    'totp.confirm',
  ]) {
    await expect(page.locator(`tr[data-action="${action}"]`).first()).toBeVisible();
  }
  await page.locator('#iv-audit-action').fill('moderation.rollback');
  await page.getByRole('button', { name: 'Filtrele' }).click();
  await expect(page.locator('tr[data-action]')).toHaveCount(1);
  await expect(page.locator('tr[data-action="moderation.rollback"]')).toContainText(line.id);
  await expectLabelledControls(page);
  await shoot(page, 'denetim');

  // Users and roles: the only admin cannot demote itself.
  await page.getByRole('link', { name: 'Kullanıcılar' }).click();
  const self = page.locator(`[data-user="${ADMIN}"]`);
  await expect(self).toBeVisible();
  await self.locator('select').selectOption('moderator');
  await self.getByRole('button', { name: 'Kaydet' }).click();
  await page
    .locator('[data-dialog="confirm"]')
    .getByRole('button', { name: 'Rolü değiştir' })
    .click();
  await expect(page.locator('[data-error="users"]')).toContainText('Son yönetici rolünü bırakamaz');
  await expect(page.locator(`[data-user="${MODERATOR}"]`)).toContainText('Moderatör');
  await shoot(page, 'kullanicilar');

  // Export per city (inline, bounded; MinIO stands in for R2).
  await page.getByRole('link', { name: 'Dışa aktarım' }).click();
  await page.locator('#iv-export-city').selectOption(CITY);
  await page.getByRole('button', { name: 'Dışa aktar' }).click();
  await expect(page.locator('[data-export="done"]')).toContainText(CITY);
  await shoot(page, 'disa-aktar');

  const unexpected = consoleErrors.filter((text) => !/40[13]|Failed to load resource/.test(text));
  expect(unexpected).toEqual([]);
});
