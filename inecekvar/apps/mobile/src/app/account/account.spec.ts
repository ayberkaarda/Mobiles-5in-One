import { computed } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { ApiError } from '@inecekvar/data-access';
import { TRACE_DRAFT_KEY } from '../contribute/trace-draft';
import {
  GUEST_FAVORITES_KEY,
  MERGED_ACCOUNTS_KEY,
  mergedFavoritesKey,
} from '../core/favorites.store';
import { SettingsPage } from '../pages/settings.page';
import {
  catalogTesting,
  CatalogTestingOptions,
  FakeNetwork,
  FakeSession,
  MemoryPreferences,
  settle,
} from '../testing/catalog.fixtures';
import {
  contributeTesting,
  FakeClock,
  FakePositions,
  FakeWakeLock,
} from '../testing/contribute.fixtures';
import { FakePurchases } from '../testing/fake-purchases';
import { i18nTesting } from '../testing/i18n.testing';
import { AccountDeletion } from './account-deletion';

function setup(options: CatalogTestingOptions = {}) {
  const session = options.session ?? new FakeSession();
  Object.assign(session, { role: computed(() => session.user()?.role ?? null) });
  const prefs = options.prefs ?? new MemoryPreferences();
  const network = options.network ?? new FakeNetwork();
  const purchases = options.purchases ?? new FakePurchases();
  TestBed.configureTestingModule({
    imports: [i18nTesting()],
    providers: [
      provideRouter([]),
      provideIonicAngular({}),
      ...catalogTesting({ ...options, session, prefs, network, purchases }),
      ...contributeTesting(new FakePositions(), new FakeWakeLock(), new FakeClock()),
    ],
  });
  return { session, prefs, network, purchases };
}

async function renderSettings(options: CatalogTestingOptions = {}) {
  const context = setup(options);
  const fixture = TestBed.createComponent(SettingsPage);
  fixture.detectChanges();
  await settle(fixture);
  fixture.detectChanges();
  return { ...context, fixture, root: fixture.nativeElement as HTMLElement };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}

function openDeletion(fixture: ComponentFixture<SettingsPage>): HTMLFormElement {
  const root = fixture.nativeElement as HTMLElement;
  const button = required<HTMLButtonElement>(root, 'button.delete-open');
  expect(button.textContent?.trim()).toBe('Hesabı sil');
  button.click();
  fixture.detectChanges();
  return required<HTMLFormElement>(root, 'form[data-view="delete"]');
}

async function submitDeletion(
  fixture: ComponentFixture<SettingsPage>,
  form: HTMLFormElement,
  password: string,
): Promise<void> {
  const confirm = required<HTMLInputElement>(form, '[data-field="confirm"]');
  confirm.checked = true;
  confirm.dispatchEvent(new Event('change', { bubbles: true }));
  const input = required<HTMLInputElement>(form, '#iv-delete-password');
  input.value = password;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  fixture.detectChanges();
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle(fixture);
  fixture.detectChanges();
}

describe('AccountDeletion', () => {
  it('does not send or clean up a deletion while offline', async () => {
    const { session, prefs, network } = setup();
    session.signIn('user-a');
    const deletion = TestBed.inject(AccountDeletion);
    await settle();
    prefs.values.set(TRACE_DRAFT_KEY, 'saved draft');
    network.set(false);

    expect(await deletion.delete('pw')).toEqual({
      ok: false,
      failure: 'offline',
      retryAfterSeconds: null,
    });
    expect(session.deleteAccount.calls).toHaveLength(0);
    expect(prefs.values.get(TRACE_DRAFT_KEY)).toBe('saved draft');
    expect(session.isSignedIn()).toBe(true);
  });

  it('keeps the draft and session when the password is wrong', async () => {
    const session = new FakeSession();
    session.signIn('user-a');
    session.deleteAccount.impl = async () => {
      throw new ApiError('problem', 401, 'auth.invalid_credentials', 'req');
    };
    const { prefs } = setup({ session });
    const deletion = TestBed.inject(AccountDeletion);
    await settle();
    prefs.values.set(TRACE_DRAFT_KEY, 'saved draft');

    expect(await deletion.delete('wrong')).toEqual({
      ok: false,
      failure: 'wrong-password',
      retryAfterSeconds: null,
    });
    expect(session.deleteAccount.calls).toEqual([['wrong']]);
    expect(prefs.values.get(TRACE_DRAFT_KEY)).toBe('saved draft');
    expect(session.user()?.id).toBe('user-a');
  });

  it.each([
    {
      label: 'recent authentication is required',
      error: new ApiError('problem', 401, 'auth.reauth_required', 'req'),
      failure: 'reauth-required',
      retryAfterSeconds: null,
    },
    {
      label: 'requests are rate limited',
      error: new ApiError('rate_limited', 429, 'rate_limited', 'req', null, 30),
      failure: 'rate-limited',
      retryAfterSeconds: 30,
    },
    {
      label: 'the network request fails',
      error: new ApiError('network', 0, 'network', 'req'),
      failure: 'offline',
      retryAfterSeconds: null,
    },
  ])('reports the failure when $label', async ({ error, failure, retryAfterSeconds }) => {
    const session = new FakeSession();
    session.signIn('user-a');
    session.deleteAccount.impl = async () => {
      throw error;
    };
    const { prefs } = setup({ session });
    const deletion = TestBed.inject(AccountDeletion);
    await settle();
    prefs.values.set(TRACE_DRAFT_KEY, 'saved draft');

    expect(await deletion.delete('pw')).toEqual({ ok: false, failure, retryAfterSeconds });
    expect(prefs.values.get(TRACE_DRAFT_KEY)).toBe('saved draft');
    expect(session.isSignedIn()).toBe(true);
  });

  it('forgets the deleted account and draft while keeping guest favourites', async () => {
    const session = new FakeSession();
    session.signIn('user-a');
    const prefs = new MemoryPreferences();
    const purchases = new FakePurchases();
    const guest = JSON.stringify([
      {
        city: 'ornek-test-sehri',
        slug: 'ornek-hat-1',
        code: 'ORN-1',
        name: '[ÖRNEK] Hat ORN-1',
        mode: 'dolmus',
        lineId: 'line-1',
      },
    ]);
    prefs.values.set(TRACE_DRAFT_KEY, 'saved draft');
    prefs.values.set(
      mergedFavoritesKey('user-a'),
      JSON.stringify(['ornek-test-sehri/ornek-hat-1']),
    );
    prefs.values.set(MERGED_ACCOUNTS_KEY, JSON.stringify(['user-b', 'user-a']));
    prefs.values.set(GUEST_FAVORITES_KEY, guest);
    setup({ session, prefs, purchases });
    const deletion = TestBed.inject(AccountDeletion);
    await settle();

    expect(await deletion.delete('pw')).toEqual({ ok: true, cleanupFailed: false });
    await settle();

    expect(session.deleteAccount.calls).toEqual([['pw']]);
    expect(prefs.values.has(TRACE_DRAFT_KEY)).toBe(false);
    expect(prefs.values.has(mergedFavoritesKey('user-a'))).toBe(false);
    expect(prefs.values.get(MERGED_ACCOUNTS_KEY)).toBe(JSON.stringify(['user-b']));
    expect(prefs.values.get(GUEST_FAVORITES_KEY)).toBe(guest);
    expect(purchases.calls).toContain('forget');
    expect(session.isSignedIn()).toBe(false);
  });

  it('sends an empty password as undefined', async () => {
    const session = new FakeSession();
    session.signIn('user-a');
    setup({ session });
    const deletion = TestBed.inject(AccountDeletion);
    await settle();

    expect(await deletion.delete('')).toEqual({ ok: true, cleanupFailed: false });
    expect(session.deleteAccount.calls).toEqual([[undefined]]);
  });
});

describe('SettingsPage account deletion', () => {
  it('shows the licence and web deletion link to guests without a deletion button', async () => {
    const { root } = await renderSettings();

    expect(root.querySelector('button.delete-open')).toBeNull();
    expect(
      Array.from(root.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Hesabı sil',
      ),
    ).toBe(false);
    expect(required<HTMLElement>(root, '[data-section="licence"]').textContent).toContain(
      'CC BY 4.0',
    );
    expect(required<HTMLAnchorElement>(root, '.web-delete a').getAttribute('href')).toBe(
      'https://inecekvar.app/hesap-silme',
    );
  });

  it('requires confirmation, submits the password and removes the form after deletion', async () => {
    const session = new FakeSession();
    session.signIn('user-a');
    const { fixture, root } = await renderSettings({ session });

    expect(root.querySelector('[data-fact="role"]')?.textContent?.trim()).toBe('Kullanıcı');
    expect(root.querySelector('[data-fact="reputation"]')?.textContent?.trim()).toBe('0');
    const form = openDeletion(fixture);
    const submit = required<HTMLButtonElement>(form, 'button[type="submit"]');
    expect(submit.disabled).toBe(true);
    const confirm = required<HTMLInputElement>(form, '[data-field="confirm"]');
    confirm.checked = true;
    confirm.dispatchEvent(new Event('change', { bubbles: true }));
    fixture.detectChanges();
    expect(submit.disabled).toBe(false);

    await submitDeletion(fixture, form, 'my-password');

    expect(session.deleteAccount.calls).toEqual([['my-password']]);
    expect(root.querySelector('[data-view="deleted"]')).not.toBeNull();
    expect(root.querySelector('form[data-view="delete"]')).toBeNull();
    expect(root.querySelector('#iv-delete-password')).toBeNull();
  });

  it('keeps the form and shows the wrong-password error', async () => {
    const session = new FakeSession();
    session.signIn('user-a');
    session.deleteAccount.impl = async () => {
      throw new ApiError('problem', 401, 'auth.invalid_credentials', 'req');
    };
    const { fixture, root } = await renderSettings({ session });

    await submitDeletion(fixture, openDeletion(fixture), 'wrong');

    expect(session.deleteAccount.calls).toEqual([['wrong']]);
    expect(root.querySelector('form[data-view="delete"]')).not.toBeNull();
    expect(root.querySelector('[data-state="error"]')?.textContent).toContain('Şifre doğru değil');
    expect(root.querySelector('[data-view="deleted"]')).toBeNull();
    expect(session.isSignedIn()).toBe(true);
  });

  it('shows the offline state and does not submit a deletion', async () => {
    const session = new FakeSession();
    session.signIn('user-a');
    const network = new FakeNetwork();
    network.connected = false;
    const { fixture, root } = await renderSettings({ session, network });
    const form = openDeletion(fixture);

    expect(form.querySelector('[data-state="offline"]')).not.toBeNull();
    expect(required<HTMLButtonElement>(form, 'button[type="submit"]').disabled).toBe(true);
    await submitDeletion(fixture, form, 'pw');

    expect(session.deleteAccount.calls).toHaveLength(0);
    expect(root.querySelector('form[data-view="delete"]')).not.toBeNull();
    expect(root.querySelector('[data-view="deleted"]')).toBeNull();
  });
});
