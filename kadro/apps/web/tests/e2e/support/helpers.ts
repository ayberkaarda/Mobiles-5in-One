import { expect, type Page } from '@playwright/test';

import { hotp, TOTP_PERIOD_SECONDS } from '../../../lib/server/admin/totp';
import { type E2eState, type SeededAccount } from './stack';

export function e2eState(): E2eState {
  // eslint-disable-next-line no-restricted-properties -- test-run hand-over from the global setup
  const raw = process.env.KADRO_E2E_STATE;
  if (raw === undefined) {
    throw new Error('the e2e global setup did not run');
  }
  return JSON.parse(raw) as E2eState;
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(value: string): Buffer {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of value.replace(/\s+/g, '')) {
    buffer = (buffer << 5) | BASE32.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

/** The code of `secret` for the current time step plus `offset` steps (window is ±1). */
export function totpCode(secret: string, offset = 0): string {
  const step = Math.floor(Date.now() / 1000 / TOTP_PERIOD_SECONDS);
  return hotp(base32Decode(secret), step + offset);
}

/**
 * Waits until at least `seconds` remain in the current time step, so a sequence of codes computed
 * now stays inside the ±1 window while the browser submits them.
 */
export async function waitForFreshStep(seconds = 20): Promise<void> {
  const remaining = () => TOTP_PERIOD_SECONDS - ((Date.now() / 1000) % TOTP_PERIOD_SECONDS);
  while (remaining() < seconds) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Collects CSP violations and uncaught page errors; `assertClean` fails the test on any. */
export function watchPage(page: Page): { assertClean(): void } {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (/content security policy|refused to (execute|load|apply)/i.test(message.text())) {
      problems.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    problems.push(`pageerror: ${error.message}`);
  });
  return {
    assertClean() {
      expect(problems).toEqual([]);
    },
  };
}

export async function signIn(page: Page, account: SeededAccount): Promise<void> {
  const { baseUrl } = e2eState();
  await page.goto(`${baseUrl}/admin/giris`);
  await page.getByLabel('E-posta').fill(account.email);
  await page.getByLabel('Şifre', { exact: true }).fill(account.password);
  const submit = page.getByRole('button', { name: 'Giriş yap' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await page.waitForURL(`${baseUrl}/admin/dogrulama`);
}

export async function stepUp(page: Page, code: string): Promise<void> {
  const { baseUrl } = e2eState();
  await page.getByLabel('Doğrulama kodu').fill(code);
  await page.getByRole('button', { name: 'Doğrula' }).click();
  await page.waitForURL(`${baseUrl}/admin/sahalar`);
}
