import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideIonicAngular } from '@ionic/angular';
import { ApiError } from '@inecekvar/data-access';
import { CityStore, PREFERENCE_STORE } from '../city/city.store';
import { FavoritesStore, GUEST_FAVORITES_KEY } from '../core/favorites.store';
import { MAP_LIBRARY_LOADER } from '../map/map-library';
import { PLANNER_NOW } from '../planner/planner.store';
import {
  catalogTesting,
  fakeAccount,
  fakeCatalog,
  FakeCatalog,
  FakeSession,
  MemoryPreferences,
  SAMPLE_CITY,
  samplePlan,
  settle,
} from '../testing/catalog.fixtures';
import { i18nTesting } from '../testing/i18n.testing';
import { FavoritesPage } from './favorites.page';
import { PlanPage } from './plan.page';

const el = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;
const clean = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim();
const text = (root: HTMLElement, selector: string) =>
  clean(root.querySelector(selector)?.textContent);

function configure(
  options: { catalog?: FakeCatalog; session?: FakeSession; prefs?: MemoryPreferences } = {},
) {
  const catalog = options.catalog ?? fakeCatalog();
  const session = options.session ?? new FakeSession();
  const account = fakeAccount(session);
  TestBed.configureTestingModule({
    imports: [i18nTesting()],
    providers: [
      provideIonicAngular({}),
      provideRouter([]),
      ...catalogTesting({ catalog, session, account, prefs: options.prefs }),
      { provide: PLANNER_NOW, useValue: () => 0 },
      { provide: MAP_LIBRARY_LOADER, useValue: () => Promise.reject(new Error('no WebGL')) },
    ],
  });
  return { catalog, session, account };
}

async function planPage(catalog = fakeCatalog()) {
  configure({ catalog });
  await TestBed.inject(CityStore).select(SAMPLE_CITY.slug);
  const fixture = TestBed.createComponent(PlanPage);
  await settle(fixture);
  return { fixture, root: el(fixture), catalog };
}

async function type(
  fixture: { whenStable(): Promise<unknown> },
  input: HTMLInputElement | null,
  value: string,
) {
  if (!input) throw new Error('missing input');
  input.value = value;
  input.dispatchEvent(new Event('input'));
  await settle(fixture);
}

async function chooseBothEnds(fixture: Parameters<typeof settle>[0] & object, root: HTMLElement) {
  const [from, to] = Array.from(root.querySelectorAll<HTMLInputElement>('form input'));
  await type(fixture, from ?? null, 'Durak 1-1');
  root.querySelector<HTMLButtonElement>('[data-end="from"] .suggestions button')?.click();
  await type(fixture, to ?? null, 'Durak 3-3');
  root.querySelector<HTMLButtonElement>('[data-end="to"] .suggestions button')?.click();
  await settle(fixture);
  return { from, to };
}

describe('plan page', () => {
  beforeEach(() => localStorage.clear());

  it('shows the empty form with transfer choices and a hint', async () => {
    const { root } = await planPage();
    expect(root.querySelectorAll('form input')).toHaveLength(2);
    expect(root.querySelector('[data-value="2"]')?.getAttribute('aria-checked')).toBe('true');
    expect(text(root, '.hint')).toContain('Kalkış ve varışı seçince');
    expect(root.querySelector('iv-itinerary-card')).toBeNull();
  });

  it('explains a missing end instead of sending', async () => {
    const { fixture, root, catalog } = await planPage();
    root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle(fixture);
    expect(text(root, '.form-error')).toContain('Nereden başlayacağını seç');
    expect(catalog.plan.calls).toHaveLength(0);
  });

  it('picks stops from suggestions, plans, lists cards and the selected steps', async () => {
    const { fixture, root, catalog } = await planPage();
    const { from, to } = await chooseBothEnds(fixture, root);
    expect(from?.value).toBe('[ÖRNEK] Durak 1-1');
    expect(to?.value).toBe('[ÖRNEK] Durak 3-3');
    root.querySelector<HTMLButtonElement>('[data-value="1"]')?.click();
    root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle(fixture);
    expect(catalog.plan.calls[0]?.[0]).toMatchObject({ city: SAMPLE_CITY.slug, max_transfers: 1 });

    const cards = Array.from(root.querySelectorAll('iv-itinerary-card'));
    expect(cards).toHaveLength(2);
    expect(
      Array.from(cards[0]?.querySelectorAll('.plate') ?? []).map((p) =>
        p.firstChild?.textContent?.trim(),
      ),
    ).toEqual(['ORN-1', 'ORN-2']);
    expect(clean(cards[0]?.querySelector('.duration')?.textContent)).toBe('≈ 20 dk');
    expect(clean(cards[0]?.querySelector('.fare')?.textContent)).toBe('≈ ₺50,00');
    expect(clean(cards[0]?.textContent)).toContain('1 aktarma');
    expect(clean(cards[1]?.textContent)).toContain('Aktarmasız');
    expect(clean(cards[1]?.querySelector('.fare')?.textContent)).toBe('Ücret bilinmiyor');
    expect(cards[0]?.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    const steps = Array.from(root.querySelectorAll('iv-itinerary-steps li .title')).map((s) =>
      clean(s.textContent),
    );
    expect(steps).toEqual([
      '80 m yürü: [ÖRNEK] Durak 1-1',
      'ORN-1 hattına bin',
      '220 m yürü: [ÖRNEK] Durak 2-3',
      'ORN-2 hattına bin',
      '40 m yürü: varış noktası',
    ]);
    // The chosen route is drawn as a strip: start, the transfer stops and the destination.
    const names = Array.from(
      root.querySelectorAll('.itinerary-strip iv-route-strip text.name'),
    ).map((n) => clean(n.textContent));
    expect(names).toHaveLength(6);
    expect(names.slice(1, 5)).toEqual([
      '[ÖRNEK] Durak 1-1',
      '[ÖRNEK] Durak 1-3',
      '[ÖRNEK] Durak 2-3',
      '[ÖRNEK] Durak 3-3',
    ]);
    expect(
      Array.from(root.querySelectorAll('.itinerary-strip iv-route-strip text.code')).map((n) =>
        clean(n.textContent),
      ),
    ).toEqual(['ORN-1', 'ORN-2']);
    expect(root.querySelectorAll('.itinerary-strip iv-route-strip path.walk')).toHaveLength(3);
    // The map waits until asked for once the results are in.
    expect(root.querySelector('.map-section iv-map')).toBeNull();
    root.querySelector<HTMLButtonElement>('.map-section .iv-button')?.click();
    await settle(fixture);
    expect(text(root, '.map-section h2')).toBe('Seçilen rota');

    cards[1]?.querySelector('button')?.click();
    await settle(fixture);
    expect(cards[1]?.querySelector('button')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelectorAll('iv-itinerary-steps li')).toHaveLength(1);
  });

  it('renders stop and line names from the API as text only', async () => {
    const catalog = fakeCatalog();
    const plan = samplePlan();
    const ride = plan.itineraries[0]?.legs[1];
    if (ride?.kind === 'ride') {
      ride.line_name = '<img src=x onerror=alert(1)>';
      ride.alight_stop = { ...ride.alight_stop, name: '<b>Durak</b>' };
    }
    catalog.plan.impl = async () => plan;
    const { fixture, root } = await planPage(catalog);
    await chooseBothEnds(fixture, root);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle(fixture);
    expect(root.querySelector('.results img, .results b, iv-itinerary-steps b')).toBeNull();
    expect(root.textContent).toContain('<b>Durak</b>');
  });

  it.each([
    ['empty', async () => samplePlan({ itineraries: [] }), 'Bu iki nokta arasında hat bulunamadı'],
    [
      'degraded',
      async () => samplePlan({ degraded: true, itineraries: [] }),
      'Planlayıcı şu an yoğun',
    ],
  ] as const)('shows the %s state', async (_, impl, heading) => {
    const catalog = fakeCatalog();
    catalog.plan.impl = impl;
    const { fixture, root } = await planPage(catalog);
    await chooseBothEnds(fixture, root);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle(fixture);
    expect(text(root, '.results iv-state h2')).toBe(heading);
  });

  it('flags degraded results above the cards', async () => {
    const catalog = fakeCatalog();
    catalog.plan.impl = async () => samplePlan({ degraded: true });
    const { fixture, root } = await planPage(catalog);
    await chooseBothEnds(fixture, root);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle(fixture);
    expect(text(root, '.banner')).toContain('en çok 1 aktarma');
    expect(root.querySelectorAll('iv-itinerary-card')).toHaveLength(2);
  });

  it('shows the 429 countdown and disables the button', async () => {
    const catalog = fakeCatalog();
    catalog.plan.impl = async () => {
      throw new ApiError('rate_limited', 429, 'rate_limited', 'req-test', null, 30);
    };
    const { fixture, root } = await planPage(catalog);
    await chooseBothEnds(fixture, root);
    root.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await settle(fixture);
    expect(text(root, '.results iv-state h2')).toBe('Çok sık rota istendi');
    expect(text(root, '.results iv-state p')).toBe('30 saniye sonra yeniden deneyebilirsin.');
    expect(root.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    expect(root.querySelector('.results iv-state button')).toBeNull();
  });
});

describe('favourites page', () => {
  beforeEach(() => localStorage.clear());

  it('shows a storage failure message for guest favorites', async () => {
    const prefs = new MemoryPreferences();
    prefs.set = async () => {
      throw new Error('quota');
    };
    configure({ prefs });
    const fixture = TestBed.createComponent(FavoritesPage);
    await settle(fixture);
    await TestBed.inject(FavoritesStore).toggle({
      city: SAMPLE_CITY.slug,
      slug: 'line',
      code: '1',
      name: 'Line',
      mode: 'dolmus',
    });
    await settle(fixture);
    expect(text(el(fixture), '[role="alert"]')).toContain('Favoriler cihaza kaydedilemedi');
  });

  const guestLine = {
    city: SAMPLE_CITY.slug,
    slug: 'ornek-hat-1',
    code: 'ORN-1',
    name: '[ÖRNEK] Hat ORN-1',
    mode: 'dolmus',
    lineId: 'line-1',
  };

  it('shows the guest list with a sign-in prompt linking to /giris', async () => {
    const prefs = new MemoryPreferences();
    prefs.values.set(GUEST_FAVORITES_KEY, JSON.stringify([guestLine]));
    configure({ prefs });
    const fixture = TestBed.createComponent(FavoritesPage);
    await settle(fixture);
    const root = el(fixture);
    expect(text(root, '[data-list="guest"] h2')).toContain('Bu cihazdaki favoriler');
    expect(text(root, 'iv-line-card .plate')).toBe('ORN-1');
    expect(text(root, '.signin h2')).toBe('Favorilerin her cihazda olsun');
    expect(root.querySelector('.signin a')?.getAttribute('href')).toBe('/giris');
  });

  it('shows the account list after sign-in with the merge note, and the guest list after sign-out', async () => {
    const prefs = new MemoryPreferences();
    prefs.values.set(GUEST_FAVORITES_KEY, JSON.stringify([guestLine]));
    const { session, account } = configure({ prefs });
    account.server.set('user-a', new Set(['line-2']));
    const fixture = TestBed.createComponent(FavoritesPage);
    await settle(fixture);
    session.signIn('user-a');
    await settle(fixture);
    await settle(fixture);
    const root = el(fixture);
    expect(text(root, '[data-list="account"] h2')).toContain('Hesabındaki favoriler');
    // ORN-2 cannot be read from the fake catalog, so its slug stands in for the code.
    expect(
      Array.from(root.querySelectorAll('iv-line-card .plate'))
        .map((p) => clean(p.textContent))
        .sort(),
    ).toEqual(['ORN-1', 'ornek-hat-2']);
    expect(text(root, '.note--ok')).toBe('Bu cihazdaki 1 favori hesabına eklendi.');
    expect(root.querySelector('.signin')).toBeNull();

    session.signOut();
    await settle(fixture);
    expect(
      Array.from(root.querySelectorAll('iv-line-card .plate')).map((p) => clean(p.textContent)),
    ).toEqual(['ORN-1']);
    expect(root.querySelector('.signin')).not.toBeNull();
    expect(
      JSON.parse(
        (TestBed.inject(PREFERENCE_STORE) as MemoryPreferences).values.get(GUEST_FAVORITES_KEY) ??
          '[]',
      ),
    ).toEqual([guestLine]);
  });

  it('offers a retry when part of the merge failed', async () => {
    const prefs = new MemoryPreferences();
    prefs.values.set(GUEST_FAVORITES_KEY, JSON.stringify([guestLine]));
    const { session, account } = configure({ prefs });
    const add = account.addFavorite.impl;
    account.addFavorite.impl = async () => {
      throw new ApiError('network', 0, 'network', 'req-test');
    };
    const fixture = TestBed.createComponent(FavoritesPage);
    await settle(fixture);
    session.signIn('user-a');
    await settle(fixture);
    await settle(fixture);
    const root = el(fixture);
    expect(text(root, '.note--warn span')).toBe(
      '1 favori hesabına eklenemedi. Yeniden deneyebilirsin.',
    );
    account.addFavorite.impl = add;
    root.querySelector<HTMLButtonElement>('.note--warn button')?.click();
    await settle(fixture);
    await settle(fixture);
    expect(text(root, '.note--ok')).toBe('Bu cihazdaki 1 favori hesabına eklendi.');
    expect(account.server.get('user-a')?.has('line-1')).toBe(true);
  });

  it('opens the sign-in stub', async () => {
    configure();
    const fixture = TestBed.createComponent(FavoritesPage);
    await settle(fixture);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    el(fixture).querySelector<HTMLAnchorElement>('.signin a')?.click();
    expect(navigate).toHaveBeenCalled();
  });
});
