import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { LanguageService } from '../core/language.service';
import { PlusPage } from '../pages/plus.page';
import { catalogTesting, FakeSession, settle } from '../testing/catalog.fixtures';
import { FAKE_OFFERS, FakePurchases } from '../testing/fake-purchases';
import { i18nTesting } from '../testing/i18n.testing';
import { PlusStore } from './plus.store';
import { createPurchasesAdapter, PURCHASES_ADAPTER, PurchasesAdapter } from './purchases';
import { RevenueCatPurchases } from './revenuecat-purchases';

function fakeApi() {
  const monthly = {
    identifier: 'monthly',
    packageType: 'MONTHLY',
    product: { price: 29.99, currencyCode: 'TRY' },
  };
  const annual = {
    identifier: 'annual',
    packageType: 'ANNUAL',
    product: { price: 249.99, currencyCode: 'TRY' },
  };
  const api = {
    isConfigured: vi.fn(async () => ({ isConfigured: false })),
    configure: vi.fn(async () => undefined),
    logIn: vi.fn(async () => undefined),
    logOut: vi.fn(async () => undefined),
    getOfferings: vi.fn(async () => ({ current: { availablePackages: [monthly, annual] } })),
    purchasePackage: vi.fn(async () => undefined),
    restorePurchases: vi.fn(async () => undefined),
    getCustomerInfo: vi.fn(async () => ({
      customerInfo: { entitlements: { active: {} as Record<string, unknown> } },
    })),
  };
  return { api, monthly, annual };
}

async function setupStore(signedIn = true) {
  const session = new FakeSession();
  if (signedIn) session.signIn('user-a');
  const purchases = new FakePurchases();
  TestBed.configureTestingModule({ providers: catalogTesting({ session, purchases }) });
  const store = TestBed.inject(PlusStore);
  await settle();
  return { session, purchases, store };
}

async function renderPlus(session: FakeSession, purchases: PurchasesAdapter) {
  TestBed.configureTestingModule({
    imports: [i18nTesting()],
    providers: [
      provideRouter([]),
      provideIonicAngular({}),
      ...catalogTesting({ session, purchases }),
    ],
  });
  TestBed.inject(PlusStore);
  await settle();
  const fixture = TestBed.createComponent(PlusPage);
  fixture.detectChanges();
  await settle(fixture);
  fixture.detectChanges();
  return { fixture, root: fixture.nativeElement as HTMLElement };
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`missing element: ${selector}`);
  return element;
}

function firstOfferId(): string {
  const offer = FAKE_OFFERS[0];
  if (!offer) throw new Error('missing fake monthly offer');
  return offer.id;
}

describe('createPurchasesAdapter', () => {
  it.each([
    { native: false, key: 'goog_abcdefghij', kind: 'unavailable', unavailable: 'web' },
    { native: true, key: '', kind: 'unavailable', unavailable: 'not-configured' },
    { native: true, key: 'sk_secret', kind: 'unavailable', unavailable: 'not-configured' },
    { native: true, key: 'goog_abcdefghij', kind: 'revenuecat', unavailable: null },
    { native: true, key: 'appl_abcdefghij', kind: 'revenuecat', unavailable: null },
  ])(
    'selects $kind ($unavailable) for native=$native and key=$key',
    ({ native, key, kind, unavailable }) => {
      const adapter = createPurchasesAdapter(native, key);

      expect(adapter.kind).toBe(kind);
      expect(adapter.unavailable).toBe(unavailable);
    },
  );

  it('offers nothing and rejects purchases on the web', async () => {
    const adapter = createPurchasesAdapter(false, 'goog_abcdefghij');

    await expect(adapter.offers()).resolves.toEqual([]);
    await expect(adapter.purchase('monthly')).rejects.toThrow('purchases unavailable: web');
  });
});

describe('RevenueCatPurchases', () => {
  it('configures the SDK with the public key and account on first identification', async () => {
    const { api } = fakeApi();
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);

    await adapter.identify('user-a');

    expect(api.configure).toHaveBeenCalledWith({ apiKey: 'goog_abcdefghij', appUserID: 'user-a' });
    expect(api.logIn).not.toHaveBeenCalled();
  });

  it('logs into an already configured SDK', async () => {
    const { api } = fakeApi();
    api.isConfigured.mockResolvedValue({ isConfigured: true });
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);

    await adapter.identify('user-b');

    expect(api.logIn).toHaveBeenCalledWith({ appUserID: 'user-b' });
    expect(api.configure).not.toHaveBeenCalled();
  });

  it('maps monthly and annual store packages to offers', async () => {
    const { api } = fakeApi();
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);

    await expect(adapter.offers()).resolves.toEqual([
      { id: 'monthly', price: 29.99, currency: 'TRY', period: 'month' },
      { id: 'annual', price: 249.99, currency: 'TRY', period: 'year' },
    ]);
  });

  it('purchases the package associated with the selected offer', async () => {
    const { api, monthly } = fakeApi();
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);
    await adapter.offers();

    await expect(adapter.purchase('monthly')).resolves.toBe('purchased');
    expect(api.purchasePackage).toHaveBeenCalledWith({ aPackage: monthly });
  });

  it('returns cancelled when the user cancels the store sheet', async () => {
    const { api } = fakeApi();
    api.purchasePackage.mockRejectedValue({ userCancelled: true });
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);
    await adapter.offers();

    await expect(adapter.purchase('monthly')).resolves.toBe('cancelled');
  });

  it('rethrows other purchase errors', async () => {
    const { api } = fakeApi();
    const error = new Error('store unavailable');
    api.purchasePackage.mockRejectedValue(error);
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);
    await adapter.offers();

    await expect(adapter.purchase('monthly')).rejects.toBe(error);
  });

  it('rejects unknown offer ids without opening a store sheet', async () => {
    const { api } = fakeApi();
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);
    await adapter.offers();

    await expect(adapter.purchase('unknown')).rejects.toThrow('unknown offer');
    expect(api.purchasePackage).not.toHaveBeenCalled();
  });

  it('reads the active plus entitlement from customer info', async () => {
    const { api } = fakeApi();
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);

    await expect(adapter.storeSaysPlus()).resolves.toBe(false);
    api.getCustomerInfo.mockResolvedValue({
      customerInfo: { entitlements: { active: { plus: {} } } },
    });
    await expect(adapter.storeSaysPlus()).resolves.toBe(true);
    api.getCustomerInfo.mockResolvedValue({
      customerInfo: { entitlements: { active: { another: {} } } },
    });
    await expect(adapter.storeSaysPlus()).resolves.toBe(false);
  });

  it('restores purchases through the SDK', async () => {
    const { api } = fakeApi();
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);

    await adapter.restore();

    expect(api.restorePurchases).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('logs out only when configured=%s', async (configured) => {
    const { api } = fakeApi();
    api.isConfigured.mockResolvedValue({ isConfigured: configured });
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);

    await adapter.forget();

    expect(api.logOut).toHaveBeenCalledTimes(configured ? 1 : 0);
  });

  it('swallows SDK logout errors', async () => {
    const { api } = fakeApi();
    api.isConfigured.mockResolvedValue({ isConfigured: true });
    api.logOut.mockRejectedValue(new Error('anonymous user'));
    const adapter = new RevenueCatPurchases('goog_abcdefghij', api as never);

    await expect(adapter.forget()).resolves.toBeUndefined();
    expect(api.logOut).toHaveBeenCalledTimes(1);
  });
});

describe('PlusStore', () => {
  it('requires sign-in for the available store', async () => {
    const { store, purchases } = await setupStore(false);

    expect(store.availability).toBe('store');
    expect(purchases.unavailable).toBeNull();
    expect(store.needsSignIn()).toBe(true);
    await store.load();
    expect(purchases.calls).toEqual([]);
    expect(store.offers()).toEqual([]);
  });

  it('identifies the signed-in account and loads both offers', async () => {
    const { store, purchases } = await setupStore();

    await store.load();

    expect(store.needsSignIn()).toBe(false);
    expect(purchases.identifiedAs).toBe('user-a');
    expect(purchases.calls).toEqual(['identify:user-a', 'offers']);
    expect(store.offers()).toEqual(FAKE_OFFERS);
    expect(store.offers()).toHaveLength(2);
    expect(store.state()).toBe('ready');
  });

  it('records a purchase and the store entitlement', async () => {
    const { store, purchases } = await setupStore();
    await store.load();

    await store.buy(firstOfferId());

    expect(purchases.calls).toContain(`purchase:${firstOfferId()}`);
    expect(store.state()).toBe('purchased');
    expect(store.storeSaysPlus()).toBe(true);
  });

  it('records a cancelled purchase without an entitlement', async () => {
    const { store, purchases } = await setupStore();
    await store.load();
    purchases.answerNextPurchase('cancelled');

    await store.buy(firstOfferId());

    expect(store.state()).toBe('cancelled');
    expect(store.storeSaysPlus()).toBe(false);
  });

  it('records purchase failures', async () => {
    const { store, purchases } = await setupStore();
    await store.load();
    purchases.fail('purchase');

    await store.buy(firstOfferId());

    expect(store.state()).toBe('error');
    expect(store.storeSaysPlus()).toBe(false);
  });

  it('records a restore and refreshes the store entitlement', async () => {
    const { store, purchases } = await setupStore();
    await store.load();
    purchases.setStoreEntitlement(true);

    await store.restore();

    expect(purchases.calls).toContain('restore');
    expect(store.state()).toBe('restored');
    expect(store.storeSaysPlus()).toBe(true);
  });

  it('forgets the store account and clears offers on sign-out', async () => {
    const { store, session, purchases } = await setupStore();
    await store.load();
    await store.buy(firstOfferId());

    session.signOut();
    await settle();

    expect(purchases.calls).toContain('forget');
    expect(purchases.identifiedAs).toBeNull();
    expect(store.offers()).toEqual([]);
    expect(store.storeSaysPlus()).toBe(false);
    expect(store.needsSignIn()).toBe(true);
    expect(store.state()).toBe('idle');
  });

  it('does not load offers on the web even when signed in', async () => {
    const session = new FakeSession();
    session.signIn('user-a');
    const adapter = createPurchasesAdapter(false, '');
    const identify = vi.spyOn(adapter, 'identify');
    const offers = vi.spyOn(adapter, 'offers');
    TestBed.configureTestingModule({
      providers: [
        ...catalogTesting({ session }),
        { provide: PURCHASES_ADAPTER, useValue: adapter },
      ],
    });
    const store = TestBed.inject(PlusStore);
    await settle();

    await store.load();

    expect(store.availability).toBe('web');
    expect(store.needsSignIn()).toBe(false);
    expect(store.state()).toBe('idle');
    expect(store.offers()).toEqual([]);
    expect(identify).not.toHaveBeenCalled();
    expect(offers).not.toHaveBeenCalled();
  });
});

describe('PlusPage', () => {
  it('explains web availability without offering a buy button', async () => {
    const { root } = await renderPlus(new FakeSession(), createPurchasesAdapter(false, ''));

    expect(required<HTMLElement>(root, '[data-state="web"]').textContent).toContain(
      'yalnızca Android ve iOS',
    );
    expect(root.querySelector('li[data-offer] button')).toBeNull();
    expect(
      Array.from(root.querySelectorAll('button')).some(
        (button) => button.textContent?.trim() === 'Satın al',
      ),
    ).toBe(false);
  });

  it('links a signed-out store user to sign-in with a Plus return path', async () => {
    const { root } = await renderPlus(new FakeSession(), new FakePurchases());
    const signIn = required<HTMLElement>(root, '[data-state="sign-in"]');

    expect(required<HTMLAnchorElement>(signIn, 'a').getAttribute('href')).toBe(
      '/giris?sonra=%2Fplus',
    );
  });

  it('renders Turkish offers and links to offline packs after purchase', async () => {
    const session = new FakeSession();
    session.signIn('user-a');
    const purchases = new FakePurchases();
    const { fixture, root } = await renderPlus(session, purchases);

    expect(root.querySelectorAll('li[data-offer]')).toHaveLength(2);
    const offer = required<HTMLLIElement>(root, 'li[data-offer]');
    expect(required<HTMLElement>(offer, '.price').textContent?.replace(/\s/g, '')).toBe(
      '₺29,99/ay',
    );
    const buy = required<HTMLButtonElement>(offer, 'button');
    expect(buy.textContent?.trim()).toBe('Satın al');
    buy.click();
    await settle(fixture);
    fixture.detectChanges();

    const outcome = required<HTMLElement>(root, '[data-outcome="purchased"]');
    expect(required<HTMLAnchorElement>(outcome, 'a').getAttribute('href')).toBe(
      '/ayarlar/cevrimdisi',
    );
    expect(purchases.calls).toContain(`purchase:${firstOfferId()}`);
  });

  it('updates the offer price when the language changes to English', async () => {
    const session = new FakeSession();
    session.signIn('user-a');
    const { fixture, root } = await renderPlus(session, new FakePurchases());

    await TestBed.inject(LanguageService).set('en');
    fixture.detectChanges();

    const price = required<HTMLElement>(root, 'li[data-offer] .price');
    expect(price.textContent?.replace(/\s/g, '')).toBe('₺29.99/month');
  });
});
