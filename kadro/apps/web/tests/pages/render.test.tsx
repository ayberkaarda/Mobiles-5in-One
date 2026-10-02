import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ContextType, ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import VerifyEmailPage, { metadata as verifyMetadata } from '../../app/(app)/e-posta-dogrula/page';
import LoginPage, { metadata as loginMetadata } from '../../app/(app)/giris/page';
import DeleteAccountMetadataSource, {
  metadata as deleteMetadata,
} from '../../app/(app)/hesap-silme/page';
import ResetPasswordPage, { metadata as resetMetadata } from '../../app/(app)/sifre-sifirla/page';
import ForgotPasswordPage, {
  metadata as forgotMetadata,
} from '../../app/(app)/sifremi-unuttum/page';
import { DeleteAccount, DeleteAccountSignedOut } from '../../components/auth/delete-account';
import { LoginForm } from '../../components/auth/login-form';

/**
 * Server render of the pages (initial state, no DOM): structure and accessibility attributes of
 * ADR-0040. Client-only states (token captured, results) are covered by the pure-function suites.
 */

type Router = NonNullable<ContextType<typeof AppRouterContext>>;
const router = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  hmrRefresh: () => undefined,
} as unknown as Router;

function render(element: ReactElement): string {
  return renderToStaticMarkup(
    <AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>,
  );
}

function count(html: string, pattern: RegExp): number {
  return (html.match(pattern) ?? []).length;
}

function expectLabelled(html: string): void {
  for (const [, id] of html.matchAll(/<input[^>]*\bid="([^"]+)"/g)) {
    expect(html, `label for ${id}`).toContain(`for="${id}"`);
  }
}

function expectCommon(html: string): void {
  expect(count(html, /<h1\b/g)).toBe(1);
  expect(count(html, /<main\b/g)).toBe(1);
  expect(html).not.toMatch(/<script\b/);
  expect(html).not.toMatch(/\son[a-z]+="/);
  expectLabelled(html);
}

describe('page metadata', () => {
  it('marks every page noindex and the token pages no-referrer', () => {
    for (const metadata of [
      verifyMetadata,
      resetMetadata,
      forgotMetadata,
      loginMetadata,
      deleteMetadata,
    ]) {
      expect(metadata.robots).toEqual({ index: false, follow: false });
      expect(String(metadata.title)).toMatch(/ · Kadro$/);
    }
    expect(verifyMetadata.referrer).toBe('no-referrer');
    expect(resetMetadata.referrer).toBe('no-referrer');
    expect(loginMetadata.referrer).toBeUndefined();
    expect(typeof DeleteAccountMetadataSource).toBe('function');
  });
});

describe('initial render', () => {
  it('/e-posta-dogrula announces the verification in a polite live region', () => {
    const html = render(<VerifyEmailPage />);
    expectCommon(html);
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
    expect(html).toContain('E-posta adresin doğrulanıyor…');
    expect(html).not.toContain('<form');
  });

  it('/sifre-sifirla renders no form before the fragment is read', () => {
    const html = render(<ResetPasswordPage />);
    expectCommon(html);
    expect(html).toContain('Bağlantı kontrol ediliyor…');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="password"');
  });

  it('/sifremi-unuttum has a labelled email field and a disabled submit until hydration', () => {
    const html = render(<ForgotPasswordPage />);
    expectCommon(html);
    expect(html).toMatch(/<input[^>]*type="email"[^>]*autocomplete="email"/i);
    expect(html).toMatch(/<form[^>]*method="post"/);
    expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
    expect(html).toMatch(/role="status"[^>]*aria-live="polite"/);
  });

  it('/giris uses username + current-password and a real show/hide button', async () => {
    const page = await LoginPage({
      searchParams: Promise.resolve({ devam: 'https://evil.example' }),
    });
    const html = render(page);
    expectCommon(html);
    expect(html).toMatch(/<input[^>]*type="email"[^>]*autocomplete="username"/i);
    expect(html).toMatch(/<input[^>]*type="password"[^>]*autocomplete="current-password"/i);
    expect(html).toMatch(
      /<button type="button"[^>]*aria-controls="password"[^>]*aria-pressed="false"/,
    );
    expect(html).toContain('Şifreyi </span>göster');
    expect(html).toContain('href="/sifremi-unuttum"');
    expect(html).not.toContain('evil.example');
  });

  it('login form only ever receives a fixed target', () => {
    const html = render(<LoginForm next="/hesap-silme" />);
    expect(html).not.toContain('hesap-silme');
  });

  it('/hesap-silme parts: signed-out link keeps the fixed continuation', () => {
    const signedOut = render(<DeleteAccountSignedOut />);
    expect(signedOut).toContain('href="/giris?devam=/hesap-silme"');
    const signedIn = render(<DeleteAccount csrfCookieName="__Host-kadro_csrf" />);
    expectLabelled(signedIn);
    expect(signedIn).toMatch(/<input[^>]*type="password"[^>]*autocomplete="current-password"/i);
    expect(signedIn).toMatch(/<input[^>]*type="checkbox"/);
    expect(signedIn).not.toContain('__Host-kadro_csrf');
  });
});
