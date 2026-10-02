import { fireEvent, screen, waitFor } from '@testing-library/react-native/pure';
import { http, HttpResponse } from 'msw';
import { type ReactElement, StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import VerifyEmailScreen from '../app/e-posta-dogrula';
import ForgotPasswordScreen from '../app/(auth)/sifremi-unuttum';
import SignInScreen from '../app/(auth)/giris';
import SignUpScreen from '../app/(auth)/kayit';
import WelcomeScreen from '../app/index';
import ResetPasswordScreen from '../app/sifre-sifirla';
import { authStore } from '../src/auth-store';
import { SIGNED_OUT_STATE } from '../src/auth-store/store';
import { REFRESH_TOKEN_KEY } from '../src/auth-store/token-storage';
import { type Language } from '../src/i18n';
import { queryKeys } from '../src/query/keys';
import { deferred } from './support/deferred';
import { issueTokens, problem } from './support/api';
import { __scriptApple } from './support/expo-apple-authentication';
import { __setLinkingURL } from './support/expo-linking';
import { __setSearchParams, routerCalls } from './support/expo-router';
import { secureStoreContents } from './support/expo-secure-store';
import { appResources, createTestI18n } from './support/i18n';
import { apiUrl, mswServer } from './support/msw';
import { createTestQueryClient, renderWithProviders, TestProviders } from './support/render';

// The screens use the app-wide API client and session; here they are wired to the MSW base URL and
// to the same auth store the components read.
vi.mock('../src/api/instance', async () => {
  const { createTestApi } = await import('./support/api');
  const { authStore: appStore } = await import('../src/auth-store/store');
  const { api, session } = createTestApi({ store: appStore });
  return { api, session };
});

const TOKEN = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v';
const OTHER_TOKEN = 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2H1g0F9e';
const MOCK_IDENTITY_TOKEN = 'mock-header.mock-payload.mock-signature';

/** Copy of the error catalog (`errors.json`) as the screens read it; the real file ships separately. */
const ERROR_CATALOG: Record<Language, Record<string, string>> = {
  tr: {
    invalid_credentials: 'E-posta veya şifre hatalı.',
    password_breached: 'Bu şifre güvenli görünmüyor. Başka bir şifre seç.',
    rate_limited: 'Çok fazla deneme yapıldı. {{seconds}} saniye sonra tekrar deneyin.',
    network_error: 'Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.',
    token_invalid: 'Bağlantı geçersiz ya da süresi dolmuş. Yeni bir bağlantı iste.',
    unknown: 'Bir sorun oluştu. Biraz sonra tekrar dene.',
  },
  en: {
    invalid_credentials: 'Incorrect email or password.',
    unknown: 'Something went wrong. Try again in a moment.',
  },
};

function i18nWithCatalog(language: Language = 'tr') {
  const resources = appResources();
  return createTestI18n(language, {
    ...resources,
    [language]: { ...resources[language], errors: ERROR_CATALOG[language] },
  });
}

function render(ui: ReactElement, language: Language = 'tr') {
  return renderWithProviders(ui, { i18n: i18nWithCatalog(language) });
}

/** Counts the requests a path receives and records their bodies. */
function watch(
  path: string,
  respond: () => Response | Promise<Response> = () => new HttpResponse(null, { status: 204 }),
) {
  const bodies: unknown[] = [];
  mswServer.use(
    http.post(apiUrl(path), async ({ request }) => {
      bodies.push(await request.json());
      return respond();
    }),
  );
  return bodies;
}

const signedInResponse = () => HttpResponse.json({ user: { id: 'u1' }, tokens: issueTokens() });

async function type(label: string, text: string) {
  await fireEvent.changeText(screen.getByLabelText(label), text);
}

async function press(name: string, role: 'button' | 'link' | 'switch' = 'button') {
  await fireEvent.press(screen.getByRole(role, { name }));
}

beforeEach(() => {
  authStore.setState(SIGNED_OUT_STATE);
});

describe('welcome screen', () => {
  it('offers sign-in and registration', async () => {
    await render(<WelcomeScreen />);
    expect(screen.getByRole('header', { name: 'Kadro' })).toBeTruthy();
    await press('Giriş yap');
    await press('Hesap oluştur');
    expect(routerCalls()).toEqual([
      { method: 'push', href: '/giris' },
      { method: 'push', href: '/kayit' },
    ]);
  });

  it('signs in with Apple through the sheet double and hides Google while it is not configured', async () => {
    const bodies = watch('/api/v1/auth/apple', signedInResponse);
    __scriptApple({
      outcome: { kind: 'credential', identityToken: MOCK_IDENTITY_TOKEN, givenName: 'Ayşe' },
    });
    await render(<WelcomeScreen />);
    expect(screen.queryByRole('button', { name: 'Google ile devam et' })).toBeNull();

    await fireEvent.press(await screen.findByRole('button', { name: 'Apple ile devam et' }));

    await waitFor(() => expect(authStore.getState().status).toBe('signedIn'));
    expect(bodies).toHaveLength(1);
    expect(secureStoreContents().has(REFRESH_TOKEN_KEY)).toBe(true);
  });

  it('shows no Apple button when the device cannot offer it', async () => {
    __scriptApple({ available: false });
    await render(<WelcomeScreen />);
    // Let the availability check settle before asserting its absence.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Giriş yap' })).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Apple ile devam et' })).toBeNull();
  });

  it('shows a cancelled Apple sheet as nothing at all', async () => {
    __scriptApple({ outcome: { kind: 'cancel' } });
    await render(<WelcomeScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Apple ile devam et' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Apple ile devam et', busy: false })).toBeTruthy(),
    );
    expect(screen.queryByTestId('form-error')).toBeNull();
    expect(authStore.getState().status).toBe('signedOut');
  });
});

describe('sign-in screen', () => {
  it('checks the fields before any request and announces each problem on its field', async () => {
    const bodies = watch('/api/v1/auth/login', signedInResponse);
    await render(<SignInScreen />);

    await press('Giriş yap');

    expect(await screen.findByText('E-posta adresini yaz.')).toBeTruthy();
    expect(screen.getByText('Şifreni yaz.')).toBeTruthy();
    expect(screen.getByLabelText('E-posta').props.accessibilityHint).toBe('E-posta adresini yaz.');
    expect(bodies).toHaveLength(0);
  });

  it('does not tell what the password rule is', async () => {
    const bodies = watch('/api/v1/auth/login', signedInResponse);
    await render(<SignInScreen />);
    await type('E-posta', 'ayse@example.com');
    await type('Şifre', 'kisa');
    await press('Giriş yap');
    await waitFor(() => expect(bodies).toHaveLength(1));
  });

  it('signs in, which opens the signed-in side of the router guard', async () => {
    const bodies = watch('/api/v1/auth/login', signedInResponse);
    await render(<SignInScreen />);
    await type('E-posta', ' Ayse@Example.com ');
    await type('Şifre', 'correct horse battery');
    await press('Giriş yap');

    await waitFor(() => expect(authStore.getState().status).toBe('signedIn'));
    expect(bodies).toEqual([
      {
        email: 'ayse@example.com',
        password: 'correct horse battery',
        deviceLabel: 'iOS app',
      },
    ]);
  });

  it('shows the catalog copy and the request reference for invalid credentials', async () => {
    watch('/api/v1/auth/login', () => problem(401, 'invalid_credentials', 'req-login-1'));
    await render(<SignInScreen />);
    await type('E-posta', 'ayse@example.com');
    await type('Şifre', 'wrong password!');
    await press('Giriş yap');

    expect(await screen.findByRole('alert', { name: 'E-posta veya şifre hatalı.' })).toBeTruthy();
    expect(screen.getByText('Hata kodu: req-login-1')).toBeTruthy();
    // Server prose never reaches the screen.
    expect(screen.queryByText(/Server title|Internal detail/)).toBeNull();
    expect(authStore.getState().status).toBe('signedOut');
    // The form stays usable for another attempt.
    expect(screen.getByRole('button', { name: 'Giriş yap', busy: false })).toBeTruthy();
  });

  it('puts the Retry-After seconds of a rate limit into the message', async () => {
    watch('/api/v1/auth/login', () =>
      HttpResponse.json(
        { status: 429, code: 'rate_limited', requestId: 'req-rl' },
        {
          status: 429,
          headers: { 'retry-after': '42', 'content-type': 'application/problem+json' },
        },
      ),
    );
    await render(<SignInScreen />);
    await type('E-posta', 'ayse@example.com');
    await type('Şifre', 'whatever password');
    await press('Giriş yap');
    expect(
      await screen.findByText('Çok fazla deneme yapıldı. 42 saniye sonra tekrar deneyin.'),
    ).toBeTruthy();
  });

  it('reports a network failure as such', async () => {
    mswServer.use(http.post(apiUrl('/api/v1/auth/login'), () => HttpResponse.error()));
    await render(<SignInScreen />);
    await type('E-posta', 'ayse@example.com');
    await type('Şifre', 'whatever password');
    await press('Giriş yap');
    expect(
      await screen.findByText('Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.'),
    ).toBeTruthy();
  });

  it('shows a busy button and sends one request however often it is pressed meanwhile', async () => {
    const release = deferred();
    const bodies = watch('/api/v1/auth/login', async () => {
      await release.promise;
      return signedInResponse();
    });
    await render(<SignInScreen />);
    await type('E-posta', 'ayse@example.com');
    await type('Şifre', 'correct horse battery');
    await press('Giriş yap');

    const busyButton = await screen.findByRole('button', { name: 'Giriş yap', busy: true });
    await fireEvent.press(busyButton);
    await fireEvent.press(busyButton);
    expect(screen.getByLabelText('E-posta').props.editable).toBe(false);

    release.resolve();
    await waitFor(() => expect(authStore.getState().status).toBe('signedIn'));
    expect(bodies).toHaveLength(1);
  });

  it('hides the password until asked and announces the switch state', async () => {
    await render(<SignInScreen />);
    expect(screen.getByLabelText('Şifre').props.secureTextEntry).toBe(true);
    expect(screen.getByRole('switch', { name: 'Şifreyi göster', checked: false })).toBeTruthy();

    await press('Şifreyi göster', 'switch');

    expect(screen.getByLabelText('Şifre').props.secureTextEntry).toBe(false);
    expect(screen.getByRole('switch', { name: 'Şifreyi gizle', checked: true })).toBeTruthy();
  });

  it('gives password managers the right hints', async () => {
    await render(<SignInScreen />);
    expect(screen.getByLabelText('E-posta').props).toMatchObject({
      autoComplete: 'email',
      textContentType: 'emailAddress',
      keyboardType: 'email-address',
      autoCapitalize: 'none',
    });
    expect(screen.getByLabelText('Şifre').props).toMatchObject({
      autoComplete: 'current-password',
      textContentType: 'password',
    });
  });

  it('links to password reset and registration', async () => {
    await render(<SignInScreen />);
    await press('Şifremi unuttum', 'link');
    await press('Hesap oluştur', 'link');
    expect(routerCalls()).toEqual([
      { method: 'push', href: '/sifremi-unuttum' },
      { method: 'replace', href: '/kayit' },
    ]);
  });

  it('is available in English', async () => {
    await render(<SignInScreen />, 'en');
    expect(screen.getByRole('header', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByLabelText('Password')).toBeTruthy();
  });
});

describe('sign-up screen', () => {
  async function fill(password = 'correct horse battery') {
    await type('Görünen ad', ' Ayşe Yılmaz ');
    await type('E-posta', 'Ayse@Example.com');
    await type('Şifre', password);
  }

  it('explains the field rules before sending anything', async () => {
    const bodies = watch('/api/v1/auth/register', () =>
      HttpResponse.json({ status: 'accepted' }, { status: 202 }),
    );
    await render(<SignUpScreen />);
    await type('Görünen ad', 'A');
    await type('E-posta', 'not-an-email');
    await type('Şifre', 'short');
    await press('Hesap oluştur');

    expect(await screen.findByText('Ad en az 2 karakter olmalı.')).toBeTruthy();
    expect(screen.getByText('Geçerli bir e-posta adresi yaz.')).toBeTruthy();
    expect(screen.getByText('Şifre en az 10 karakter olmalı.')).toBeTruthy();
    expect(bodies).toHaveLength(0);
  });

  it('shows the password rule as guidance while there is no error', async () => {
    await render(<SignUpScreen />);
    expect(screen.getByLabelText('Şifre').props.accessibilityHint).toBe('En az 10 karakter.');
    expect(screen.getByLabelText('Şifre').props).toMatchObject({
      autoComplete: 'new-password',
      textContentType: 'newPassword',
    });
  });

  it('ends with "check your email" and no session, then continues to sign-in', async () => {
    const bodies = watch('/api/v1/auth/register', () =>
      HttpResponse.json({ status: 'accepted' }, { status: 202 }),
    );
    await render(<SignUpScreen />);
    await fill();
    await press('Hesap oluştur');

    expect(await screen.findByRole('header', { name: 'E-postanı kontrol et' })).toBeTruthy();
    expect(bodies).toEqual([
      { email: 'ayse@example.com', password: 'correct horse battery', displayName: 'Ayşe Yılmaz' },
    ]);
    expect(authStore.getState().status).toBe('signedOut');
    expect(secureStoreContents().has(REFRESH_TOKEN_KEY)).toBe(false);

    await press('Giriş yapmaya geç');
    expect(routerCalls()).toEqual([{ method: 'replace', href: '/giris' }]);
  });

  it('keeps the form and shows the breach message', async () => {
    watch('/api/v1/auth/register', () => problem(422, 'password_breached'));
    await render(<SignUpScreen />);
    await fill('password123456');
    await press('Hesap oluştur');
    expect(
      await screen.findByText('Bu şifre güvenli görünmüyor. Başka bir şifre seç.'),
    ).toBeTruthy();
    expect(screen.getByLabelText('Görünen ad').props.value).toBe(' Ayşe Yılmaz ');
  });
});

describe('forgot-password screen', () => {
  it('validates the address, then answers the same way for any address', async () => {
    const bodies = watch('/api/v1/auth/forgot', () =>
      HttpResponse.json({ status: 'accepted' }, { status: 202 }),
    );
    await render(<ForgotPasswordScreen />);
    await type('E-posta', 'nope');
    await press('Bağlantı gönder');
    expect(await screen.findByText('Geçerli bir e-posta adresi yaz.')).toBeTruthy();
    expect(bodies).toHaveLength(0);

    await type('E-posta', 'Unknown@Example.com');
    await press('Bağlantı gönder');
    expect(await screen.findByRole('header', { name: 'E-postanı kontrol et' })).toBeTruthy();
    expect(
      screen.getByText(
        'Bu adrese kayıtlı bir hesap varsa şifre sıfırlama bağlantısını gönderdik. Bağlantı kısa süre geçerlidir.',
      ),
    ).toBeTruthy();
    expect(bodies).toEqual([{ email: 'unknown@example.com' }]);
  });

  it('goes back, or to sign-in when there is nothing to go back to', async () => {
    watch('/api/v1/auth/forgot', () => HttpResponse.json({ status: 'accepted' }, { status: 202 }));
    await render(<ForgotPasswordScreen />);
    await press('Girişe dön', 'link');
    expect(routerCalls()).toEqual([{ method: 'replace', href: '/giris' }]);
  });
});

describe('reset-password screen', () => {
  const linkWith = (token: string) => `https://kadro.app/sifre-sifirla#token=${token}`;

  it('shows "link invalid" without a request when there is no usable token', async () => {
    const bodies = watch('/api/v1/auth/reset');
    __setLinkingURL('https://kadro.app/sifre-sifirla#token=short');
    await render(<ResetPasswordScreen />);
    expect(await screen.findByRole('header', { name: 'Bağlantı geçersiz' })).toBeTruthy();
    await press('Yeni bağlantı iste');
    expect(routerCalls()).toEqual([{ method: 'replace', href: '/sifremi-unuttum' }]);
    expect(bodies).toHaveLength(0);
  });

  it('sets the new password with the emailed token and points to sign-in', async () => {
    const bodies = watch('/api/v1/auth/reset');
    __setLinkingURL(linkWith(TOKEN));
    await render(<ResetPasswordScreen />);

    await type('Yeni şifre', 'short');
    await press('Şifreyi değiştir');
    expect(await screen.findByText('Şifre en az 10 karakter olmalı.')).toBeTruthy();
    expect(bodies).toHaveLength(0);

    await type('Yeni şifre', 'a brand new password');
    await press('Şifreyi değiştir');
    expect(await screen.findByRole('header', { name: 'Şifren değişti' })).toBeTruthy();
    expect(bodies).toEqual([{ token: TOKEN, password: 'a brand new password' }]);

    await press('Giriş yap');
    expect(routerCalls()).toEqual([{ method: 'replace', href: '/giris' }]);
  });

  it('reads the token from the app scheme route parameter too', async () => {
    const bodies = watch('/api/v1/auth/reset');
    __setSearchParams({ token: TOKEN });
    await render(<ResetPasswordScreen />);
    await type('Yeni şifre', 'a brand new password');
    await press('Şifreyi değiştir');
    await screen.findByRole('header', { name: 'Şifren değişti' });
    expect(bodies).toEqual([{ token: TOKEN, password: 'a brand new password' }]);
  });

  it('signs a signed-in user out on this device, since the server revoked every session', async () => {
    watch('/api/v1/auth/reset');
    await renderSignedInSession();
    __setLinkingURL(linkWith(TOKEN));
    await render(<ResetPasswordScreen />);
    await type('Yeni şifre', 'a brand new password');
    await press('Şifreyi değiştir');
    await screen.findByRole('header', { name: 'Şifren değişti' });
    await waitFor(() => expect(authStore.getState().status).toBe('signedOut'));
    expect(secureStoreContents().has(REFRESH_TOKEN_KEY)).toBe(false);
  });

  it('turns a rejected token into the "link invalid" state', async () => {
    mswServer.use(http.post(apiUrl('/api/v1/auth/reset'), () => problem(401, 'token_invalid')));
    __setLinkingURL(linkWith(TOKEN));
    await render(<ResetPasswordScreen />);
    await type('Yeni şifre', 'a brand new password');
    await press('Şifreyi değiştir');
    expect(await screen.findByRole('header', { name: 'Bağlantı geçersiz' })).toBeTruthy();
  });

  it('shows a breached password as a form error and keeps the token', async () => {
    const bodies: unknown[] = [];
    let attempt = 0;
    mswServer.use(
      http.post(apiUrl('/api/v1/auth/reset'), async ({ request }) => {
        bodies.push(await request.json());
        attempt += 1;
        return attempt === 1
          ? problem(422, 'password_breached')
          : new HttpResponse(null, { status: 204 });
      }),
    );
    __setLinkingURL(linkWith(TOKEN));
    await render(<ResetPasswordScreen />);
    await type('Yeni şifre', 'password123456');
    await press('Şifreyi değiştir');
    expect(
      await screen.findByText('Bu şifre güvenli görünmüyor. Başka bir şifre seç.'),
    ).toBeTruthy();
    await type('Yeni şifre', 'a different long password');
    await press('Şifreyi değiştir');
    await screen.findByRole('header', { name: 'Şifren değişti' });
    expect(bodies).toEqual([
      { token: TOKEN, password: 'password123456' },
      { token: TOKEN, password: 'a different long password' },
    ]);
  });

  it('starts over with a newer link opened while the screen is up', async () => {
    const bodies = watch('/api/v1/auth/reset');
    __setLinkingURL(linkWith(TOKEN));
    const i18n = i18nWithCatalog();
    const queryClient = createTestQueryClient();
    const view = await renderWithProviders(<ResetPasswordScreen />, { i18n, queryClient });
    await type('Yeni şifre', 'typed for the first link');

    __setLinkingURL(linkWith(OTHER_TOKEN));
    await view.rerender(
      <TestProviders i18n={i18n} queryClient={queryClient}>
        <ResetPasswordScreen />
      </TestProviders>,
    );
    await waitFor(() => expect(screen.getByLabelText('Yeni şifre').props.value).toBe(''));

    await type('Yeni şifre', 'a brand new password');
    await press('Şifreyi değiştir');
    await screen.findByRole('header', { name: 'Şifren değişti' });
    expect(bodies).toEqual([{ token: OTHER_TOKEN, password: 'a brand new password' }]);
  });
});

async function renderSignedInSession() {
  // Starts a session the way a sign-in does, through the mocked app session.
  const { session } = await import('../src/api/instance');
  await session.establish(issueTokens());
  expect(authStore.getState().status).toBe('signedIn');
}

describe('verify-email screen', () => {
  const linkWith = (token: string) => `https://kadro.app/e-posta-dogrula#token=${token}`;

  it('verifies once under StrictMode double effects and re-renders, and refreshes the cached profile', async () => {
    const bodies = watch('/api/v1/auth/verify-email');
    __setLinkingURL(linkWith(TOKEN));
    const queryClient = createTestQueryClient();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const i18n = i18nWithCatalog();
    // StrictMode runs every effect twice in development; the single-use token must still be sent once.
    const view = await renderWithProviders(
      <StrictMode>
        <VerifyEmailScreen />
      </StrictMode>,
      { i18n, queryClient },
    );
    const again = (
      <TestProviders i18n={i18n} queryClient={queryClient}>
        <StrictMode>
          <VerifyEmailScreen />
        </StrictMode>
      </TestProviders>
    );

    expect(await screen.findByRole('header', { name: 'E-postan doğrulandı' })).toBeTruthy();
    await view.rerender(again);
    await view.rerender(again);

    expect(bodies).toEqual([{ token: TOKEN }]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.me() });
  });

  it('shows a progress indicator with an accessible name while it waits', async () => {
    const release = deferred();
    watch('/api/v1/auth/verify-email', async () => {
      await release.promise;
      return new HttpResponse(null, { status: 204 });
    });
    __setLinkingURL(linkWith(TOKEN));
    await render(<VerifyEmailScreen />);
    expect(
      await screen.findByRole('progressbar', { name: 'E-posta adresin doğrulanıyor' }),
    ).toBeTruthy();
    release.resolve();
    await screen.findByRole('header', { name: 'E-postan doğrulandı' });
  });

  it('continues to sign-in when signed out and back to the app when signed in', async () => {
    watch('/api/v1/auth/verify-email');
    __setLinkingURL(linkWith(TOKEN));
    await render(<VerifyEmailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Giriş yap' }));
    expect(routerCalls().at(-1)).toEqual({ method: 'replace', href: '/giris' });
  });

  it('goes back into the app for a signed-in user', async () => {
    watch('/api/v1/auth/verify-email');
    await renderSignedInSession();
    __setLinkingURL(linkWith(TOKEN));
    await render(<VerifyEmailScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Uygulamaya dön' }));
    expect(routerCalls().at(-1)).toEqual({ method: 'replace', href: '/maclar' });
  });

  it('shows "link invalid" for a rejected token and does not repeat the single-use request', async () => {
    const bodies = watch('/api/v1/auth/verify-email', () => problem(401, 'token_invalid'));
    __setLinkingURL(linkWith(TOKEN));
    await render(<VerifyEmailScreen />);
    expect(await screen.findByRole('header', { name: 'Bağlantı geçersiz' })).toBeTruthy();
    expect(bodies).toHaveLength(1);
  });

  it('shows "link invalid" without any request when the link has no token', async () => {
    const bodies = watch('/api/v1/auth/verify-email');
    await render(<VerifyEmailScreen />);
    expect(await screen.findByRole('header', { name: 'Bağlantı geçersiz' })).toBeTruthy();
    expect(bodies).toHaveLength(0);
  });

  it('reports a transport failure with the catalog copy', async () => {
    mswServer.use(http.post(apiUrl('/api/v1/auth/verify-email'), () => HttpResponse.error()));
    __setLinkingURL(linkWith(TOKEN));
    await render(<VerifyEmailScreen />);
    expect(await screen.findByRole('header', { name: 'Doğrulanamadı' })).toBeTruthy();
    expect(
      screen.getByText('Bağlantı kurulamadı. İnternet bağlantını kontrol edip tekrar dene.'),
    ).toBeTruthy();
  });
});
