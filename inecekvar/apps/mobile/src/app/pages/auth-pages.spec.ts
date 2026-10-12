import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideIonicAngular } from '@ionic/angular';
import { ApiError, Me, SessionStore, StatusResponse } from '@inecekvar/data-access';
import { APP_NOW } from '../shared/countdown';
import { FakeSession, settle, spy } from '../testing/catalog.fixtures';
import { i18nTesting } from '../testing/i18n.testing';
import { MagicLinkPage } from './magic-link.page';
import { RegisterPage } from './register.page';
import { SigninPage } from './signin.page';

const SECRET = 'gizli-sifre-1234';

@Component({ template: '<p class="landed">ok</p>' })
class Landing {}

class FakeAuthSession extends FakeSession {
  readonly pending = signal(false);
  readonly hasPendingMagicLink = this.pending.asReadonly();
  readonly login = spy(async (email: string, password: string): Promise<Me> => {
    void [email, password];
    this.signIn();
    return this.user() as Me;
  });
  readonly register = spy(
    async (email: string, password: string, name?: string): Promise<StatusResponse> => {
      void [email, password, name];
      return { status: 'check_email' };
    },
  );
  readonly requestMagicLink = spy(async (email: string): Promise<StatusResponse> => {
    void email;
    return { status: 'check_email' };
  });
  readonly completeMagicLink = spy(async (password?: string): Promise<Me> => {
    void password;
    this.pending.set(false);
    this.signIn();
    return this.user() as Me;
  });
}

const problem = (status: number, code: string, retry: number | null = null) =>
  new ApiError(status === 429 ? 'rate_limited' : 'problem', status, code, 'req', null, retry);

async function open(url: string, session = new FakeAuthSession()) {
  TestBed.configureTestingModule({
    imports: [i18nTesting()],
    providers: [
      provideIonicAngular({}),
      provideRouter([
        { path: 'giris', component: SigninPage },
        { path: 'giris/kayit', component: RegisterPage },
        { path: 'giris/baglanti', component: MagicLinkPage },
        { path: 'katki', component: Landing },
        { path: 'katki/kayit', component: Landing },
      ]),
      { provide: SessionStore, useValue: session },
      { provide: APP_NOW, useValue: () => Date.parse('2026-10-12T10:00:00Z') },
    ],
  });
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle(harness.fixture);
  const root = harness.routeNativeElement as HTMLElement;
  return { harness, root, session, router: TestBed.inject(Router) };
}

async function type(
  harness: RouterTestingHarness,
  input: HTMLInputElement | null | undefined,
  value: string,
) {
  if (!input) throw new Error('missing input');
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await settle(harness.fixture);
}

async function submit(harness: RouterTestingHarness, root: HTMLElement) {
  root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  await settle(harness.fixture);
}

const text = (el: Element | null | undefined) => el?.textContent?.replace(/\s+/g, ' ').trim();

/** Nothing typed as a password may reach the URL, history state or web storage. */
function expectNoSecretKept(router: Router) {
  expect(router.url).not.toContain(SECRET);
  expect(location.href).not.toContain(SECRET);
  expect(JSON.stringify(history.state ?? null)).not.toContain(SECRET);
  expect(JSON.stringify({ ...localStorage })).not.toContain(SECRET);
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(SECRET);
}

describe('sign-in page', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('validates before calling the API', async () => {
    const { harness, root, session } = await open('/giris');
    await submit(harness, root);
    expect(text(root.querySelector('#iv-signin-email-error'))).toBe('E-posta adresini yaz.');
    expect(root.textContent).toContain('Şifreni yaz.');
    expect(session.login.calls).toHaveLength(0);
  });

  it('signs in, returns to the requested page and keeps the password nowhere', async () => {
    const { harness, root, session, router } = await open('/giris?sonra=%2Fkatki%2Fkayit');
    await type(
      harness,
      root.querySelector<HTMLInputElement>('#iv-signin-email'),
      ' deniz@ornek.test ',
    );
    await type(harness, root.querySelector<HTMLInputElement>('#iv-signin-password'), SECRET);
    await submit(harness, root);
    expect(session.login.calls).toEqual([['deniz@ornek.test', SECRET]]);
    expect(router.url).toBe('/katki/kayit');
    expectNoSecretKept(router);
  });

  it('ignores an external return address', async () => {
    const { harness, root, router } = await open('/giris?sonra=https:%2F%2Fevil.example');
    await type(
      harness,
      root.querySelector<HTMLInputElement>('#iv-signin-email'),
      'deniz@ornek.test',
    );
    await type(harness, root.querySelector<HTMLInputElement>('#iv-signin-password'), SECRET);
    await submit(harness, root);
    expect(router.url).toBe('/katki');
  });

  it('shows one generic message for a failed sign-in', async () => {
    const session = new FakeAuthSession();
    session.login.impl = async () => {
      throw problem(401, 'auth.invalid_credentials');
    };
    const { harness, root, router } = await open('/giris', session);
    await type(
      harness,
      root.querySelector<HTMLInputElement>('#iv-signin-email'),
      'deniz@ornek.test',
    );
    await type(harness, root.querySelector<HTMLInputElement>('#iv-signin-password'), SECRET);
    await submit(harness, root);
    expect(text(root.querySelector('.failure'))).toBe('E-posta ya da şifre hatalı.');
    expect(router.url).toBe('/giris');
    expectNoSecretKept(router);
  });

  it('counts down a rate limit and disables the button meanwhile', async () => {
    const session = new FakeAuthSession();
    session.login.impl = async () => {
      throw problem(429, 'rate_limited', 120);
    };
    const { harness, root } = await open('/giris', session);
    await type(
      harness,
      root.querySelector<HTMLInputElement>('#iv-signin-email'),
      'deniz@ornek.test',
    );
    await type(harness, root.querySelector<HTMLInputElement>('#iv-signin-password'), SECRET);
    await submit(harness, root);
    expect(text(root.querySelector('.failure'))).toBe(
      'Çok fazla deneme. 120 sn sonra yeniden dene.',
    );
    expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
  });

  it('clears the password field when the page is left', async () => {
    const { harness, root } = await open('/giris');
    const input = root.querySelector<HTMLInputElement>('#iv-signin-password');
    await type(harness, input, SECRET);
    const page = harness.routeDebugElement?.componentInstance as SigninPage;
    page.ionViewDidLeave();
    await settle(harness.fixture);
    expect(root.querySelector<HTMLInputElement>('#iv-signin-password')?.value).toBe('');
  });

  it('sends a magic link and paces the resend', async () => {
    const { harness, root, session } = await open('/giris');
    const [, linkMode] = Array.from(root.querySelectorAll<HTMLButtonElement>('.mode button'));
    linkMode?.click();
    await settle(harness.fixture);
    expect(root.querySelector('#iv-signin-password')).toBeNull();
    await type(
      harness,
      root.querySelector<HTMLInputElement>('#iv-signin-email'),
      'deniz@ornek.test',
    );
    await submit(harness, root);
    expect(session.requestMagicLink.calls).toEqual([['deniz@ornek.test']]);
    const sent = root.querySelector('[data-state="link-sent"]');
    expect(text(sent?.querySelector('h2'))).toBe('E-postanı kontrol et');
    const resend = sent?.querySelector<HTMLButtonElement>('button');
    expect(resend?.disabled).toBe(true);
    expect(text(resend)).toBe('60 sn sonra yeniden gönderebilirsin');
  });
});

describe('register page', () => {
  it('shows the password policy as hints and refuses a weak password locally', async () => {
    const { harness, root, session } = await open('/giris/kayit');
    await type(
      harness,
      root.querySelector<HTMLInputElement>('#iv-register-email'),
      'deniz@ornek.test',
    );
    await type(harness, root.querySelector<HTMLInputElement>('#iv-register-password'), 'kisa');
    const [length, notEmail] = Array.from(root.querySelectorAll('.policy li'));
    expect(length?.classList.contains('ok')).toBe(false);
    expect(notEmail?.classList.contains('ok')).toBe(true);
    expect(text(length)).toBe('10 ile 128 karakter arası');
    await submit(harness, root);
    expect(root.textContent).toContain('Şifre en az 10 karakter olmalı.');
    expect(session.register.calls).toHaveLength(0);
  });

  it('shows the server policy answer and then the check-your-email state', async () => {
    const session = new FakeAuthSession();
    session.register.impl = async () => {
      throw problem(422, 'auth.weak_password');
    };
    const { harness, root, router } = await open('/giris/kayit', session);
    await type(
      harness,
      root.querySelector<HTMLInputElement>('#iv-register-email'),
      'deniz@ornek.test',
    );
    await type(harness, root.querySelector<HTMLInputElement>('#iv-register-password'), SECRET);
    await submit(harness, root);
    expect(text(root.querySelector('.failure'))).toContain('bilinen sızıntılarda geçmesin');

    session.register.impl = async () => ({ status: 'check_email' });
    await submit(harness, root);
    expect(session.register.calls.at(-1)).toEqual(['deniz@ornek.test', SECRET]);
    expect(root.querySelector('[data-state="register-sent"]')).not.toBeNull();
    expectNoSecretKept(router);
  });
});

describe('magic-link page', () => {
  it('explains a missing or used link', async () => {
    const { root } = await open('/giris/baglanti');
    expect(root.querySelector('[data-view="missing"]')).not.toBeNull();
    expect(root.textContent).toContain('Bağlantı bulunamadı');
  });

  it('verifies a captured link and continues to Katkı', async () => {
    const session = new FakeAuthSession();
    session.pending.set(true);
    const { session: s, router } = await open('/giris/baglanti', session);
    expect(s.completeMagicLink.calls).toEqual([[undefined]]);
    expect(router.url).toBe('/katki');
  });

  it('asks a registration link for the password, then verifies with it', async () => {
    const session = new FakeAuthSession();
    session.pending.set(true);
    session.completeMagicLink.impl = async (password?: string) => {
      if (password === undefined) throw problem(401, 'auth.invalid_credentials');
      session.pending.set(false);
      session.signIn();
      return session.user() as Me;
    };
    const { harness, root, router } = await open('/giris/baglanti', session);
    expect(root.querySelector('[data-view="password"]')).not.toBeNull();
    await type(harness, root.querySelector<HTMLInputElement>('#iv-link-password'), SECRET);
    await submit(harness, root);
    expect(session.completeMagicLink.calls.at(-1)).toEqual([SECRET]);
    expect(router.url).toBe('/katki');
    expectNoSecretKept(router);
  });

  it('reports an expired link', async () => {
    const session = new FakeAuthSession();
    session.pending.set(true);
    session.completeMagicLink.impl = async () => {
      session.pending.set(false);
      throw problem(401, 'auth.token_invalid');
    };
    const { root } = await open('/giris/baglanti', session);
    expect(root.querySelector('[data-view="failed"]')).not.toBeNull();
    expect(root.textContent).toContain('süresi dolmuş');
  });
});
