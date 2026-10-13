import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { REAL_STACK } from '../stack-env.mjs';

/**
 * Web account deletion on /hesap-silme against the real local API (ADR-0057): an account is
 * registered and given a favourite through the API, signs in on the page (cookie session through
 * the same-origin proxy), is refused with a wrong password without losing the session, sends
 * nothing while offline, deletes with the right password and sees the 202 result. Then the old
 * token is refused, the immediate scrub is visible in the database, the hard-delete job runs
 * once after the grace date is moved, and the password login is refused. Needs
 * `node scripts/real-stack.mjs up` and IV_E2E_REAL_API=1; otherwise the scenario is skipped.
 */
const REAL = process.env['IV_E2E_REAL_API'] === '1';
const PROXY = `http://127.0.0.1:${REAL_STACK.proxyPort}`;
const API = `http://127.0.0.1:${REAL_STACK.apiPort}/v1`;
const CITY = 'ornek-test-sehri';
const PASSWORD = 'dolmus-durak-2026!';
const stamp = Date.now().toString(36);
const EMAIL = `silinecek-${stamp}@example.com`;
// Own client address per run, so registration and login windows of other specs never apply.
const CLIENT_IP = `10.57.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
const API_HEADERS = { 'X-Real-IP': CLIENT_IP };

test.skip(!REAL, 'needs the real API stack: node scripts/real-stack.mjs up and IV_E2E_REAL_API=1');
test.describe.configure({ mode: 'serial' });

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
async function register(request: APIRequestContext): Promise<string> {
  const registered = await request.post(`${API}/auth/register`, {
    headers: API_HEADERS,
    data: { email: EMAIL, password: PASSWORD, mode: 'bearer' },
  });
  expect(registered.status()).toBe(202);
  const verified = await request.post(`${API}/auth/magic-link/verify`, {
    headers: API_HEADERS,
    data: { token: await mailedToken(request, EMAIL), mode: 'bearer', password: PASSWORD },
  });
  expect(verified.status()).toBe(200);
  return ((await verified.json()) as { access_token: string }).access_token;
}

function sql(query: string): string {
  return execFileSync(
    'docker',
    [
      'exec',
      `${REAL_STACK.project}-postgres-1`,
      'psql',
      '-U',
      'inecekvar',
      '-d',
      'inecekvar',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-c',
      query,
    ],
    { encoding: 'utf8' },
  ).trim();
}

/** Runs the real hard-delete job once (`app/workers/main.py::deletion_job`). */
function runDeletionJob(): string {
  const script = [
    'import asyncio',
    'from app.workers.main import deletion_job, shutdown, startup',
    'async def main():',
    '    ctx = {}',
    '    await startup(ctx)',
    '    try:',
    '        print(await deletion_job(ctx))',
    '    finally:',
    '        await shutdown(ctx)',
    'asyncio.run(main())',
  ].join('\n');
  return execFileSync('uv', ['run', 'python', '-c', script], {
    cwd: join(__dirname, '../../../api'),
    env: { ...process.env, ...REAL_STACK.apiEnv },
    encoding: 'utf8',
  }).trim();
}

/** Every form control on the page has a label (a light check; axe is not in the workspace). */
async function expectLabelledControls(page: Page): Promise<void> {
  const unlabelled = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, select, textarea'))
      .filter((element) => {
        const control = element as HTMLInputElement;
        return control.labels?.length === 0 && !control.getAttribute('aria-label');
      })
      .map((element) => element.id || element.tagName),
  );
  expect(unlabelled).toEqual([]);
}

test('account deletion on /hesap-silme against the real API', async ({ page, request }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.setExtraHTTPHeaders({ 'x-e2e-client-ip': CLIENT_IP });

  const token = await register(request);
  const auth = { ...API_HEADERS, Authorization: `Bearer ${token}` };
  const line = (await (
    await request.get(`${API}/lines/ornek-hat-1`, { params: { city: CITY } })
  ).json()) as { id: string };
  expect((await request.put(`${API}/me/favorites/${line.id}`, { headers: auth })).status()).toBe(
    204,
  );
  const me = (await (await request.get(`${API}/me`, { headers: auth })).json()) as { id: string };
  if (!/^[0-9a-f-]{36}$/.test(me.id)) throw new Error('unexpected user id');
  expect(sql(`select count(*) from favorites where user_id = '${me.id}'`)).toBe('1');

  // The informative page stays indexable; the panel replaces the fallback after hydration.
  await page.goto(`${PROXY}/hesap-silme`);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /^index,follow/);
  const panel = page.locator('[data-iv-deletion]');
  await expect(panel).toBeVisible();
  await expect(page.locator('[data-deletion-fallback]')).toHaveCount(0);
  await expect(panel.locator('[data-deletion="grace-warning"]')).toContainText(
    'giriş yapmak silme isteğini iptal eder',
  );
  await expectLabelledControls(page);

  await panel.getByLabel('E-posta').fill(EMAIL);
  await panel.getByLabel('Şifre', { exact: true }).fill(PASSWORD);
  await panel.getByRole('button', { name: 'Giriş yap' }).click();
  await expect(panel.locator('[data-deletion="email"]')).toHaveText(EMAIL);
  await expect(panel).toContainText('“silinmiş katkıcı”');
  await expectLabelledControls(page);

  const deleteButton = panel.getByRole('button', { name: 'Hesabı sil' });
  await panel.getByLabel('Anladım, hesabımı silmek istiyorum.').check();
  await expect(deleteButton).toBeDisabled();

  // Wrong password: an answer, not the end of the session.
  await panel.getByLabel('Şifren (güvenlik için yeniden)').fill('yanlis-sifre-2026');
  await deleteButton.click();
  await expect(panel.getByRole('alert')).toContainText('Şifre doğru değil');
  await expect(panel.locator('[data-deletion="email"]')).toHaveText(EMAIL);
  const sessionStatus = await page.evaluate(async () => {
    const response = await fetch('/api/v1/me', { credentials: 'include' });
    return response.status;
  });
  expect(sessionStatus).toBe(200);

  // Offline: nothing is sent, the account stays.
  await page.context().setOffline(true);
  await panel.getByLabel('Şifren (güvenlik için yeniden)').fill(PASSWORD);
  await deleteButton.click();
  await expect(panel.getByRole('alert')).toContainText('İnternet yok');
  await page.context().setOffline(false);
  expect(sql(`select deactivated_at is null from users where id = '${me.id}'`)).toBe('t');

  await panel.getByLabel('Şifren (güvenlik için yeniden)').fill(PASSWORD);
  const accepted = page.waitForResponse(
    (response) => response.url().endsWith('/api/v1/me') && response.request().method() === 'DELETE',
  );
  await deleteButton.click();
  const answer = await accepted;
  expect(answer.status()).toBe(202);
  expect(await answer.json()).toEqual({ status: 'deletion_scheduled' });
  const done = panel.locator('[data-deletion="done"]');
  await expect(done).toContainText('Hesabın silinmek üzere kapatıldı');
  await expect(done).toContainText('7 gün içinde giriş yaparsan silme iptal olur');
  await expect(panel.locator('input')).toHaveCount(0);

  // Local state: no session cookie, nothing about the account in browser storage.
  const cookies = await page.context().cookies(PROXY);
  expect(cookies.filter((cookie) => /session/i.test(cookie.name))).toEqual([]);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(EMAIL);
  expect(stored).not.toContain(PASSWORD);
  expect(
    await page.evaluate(async () => (await fetch('/api/v1/me', { credentials: 'include' })).status),
  ).toBe(401);

  // API and database: the old token is refused, the immediate part of ADR-0026 happened.
  expect((await request.get(`${API}/me`, { headers: auth })).status()).toBe(401);
  expect(sql(`select deactivated_at is not null from users where id = '${me.id}'`)).toBe('t');
  expect(sql(`select state from deletion_requests where user_id = '${me.id}'`)).toBe('scheduled');
  expect(sql(`select count(*) from favorites where user_id = '${me.id}'`)).toBe('0');
  expect(
    sql(`select count(*) from refresh_tokens where user_id = '${me.id}' and revoked_at is null`),
  ).toBe('0');

  // The grace date is moved into the past and the real hard-delete job runs once.
  sql(
    `update deletion_requests set scheduled_for = now() - interval '1 minute' where user_id = '${me.id}'`,
  );
  expect(Number(runDeletionJob().split('\n').pop())).toBeGreaterThanOrEqual(1);
  expect(sql(`select count(*) from users where id = '${me.id}' or email = '${EMAIL}'`)).toBe('0');
  expect(sql(`select count(*) from deletion_requests where user_id = '${me.id}'`)).toBe('0');
  expect(sql(`select count(*) from audit_logs where target_id = '${me.id}'`)).toBe('0');
  const login = await request.post(`${API}/auth/login`, {
    headers: API_HEADERS,
    data: { email: EMAIL, password: PASSWORD, mode: 'bearer' },
  });
  expect(login.status()).toBe(401);
  expect(((await login.json()) as { code: string }).code).toBe('auth.invalid_credentials');

  expect(consoleErrors.filter((text) => !/status of (401|429)/.test(text))).toEqual([]);
});
