import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideIonicAngular } from '@ionic/angular';
import { appRoutes } from '../app.routes';
import { CityStore, PREFERENCE_STORE } from '../city/city.store';
import { DARK_CLASS } from '../core/theme.service';
import { MAP_LIBRARY_LOADER } from '../map/map-library';
import { LocateResult } from '../shared/location';
import {
  catalogTesting,
  fakeCatalog,
  FakeCatalog,
  MemoryPreferences,
  offline,
  SAMPLE_CITY,
  sampleLineDetail,
  settle,
} from '../testing/catalog.fixtures';
import { i18nTesting } from '../testing/i18n.testing';
import { ContributePage } from './contribute.page';
import { FavoritesPage } from './favorites.page';
import { LinePage } from './line.page';
import { NotFoundPage } from './not-found.page';
import { PlanPage } from './plan.page';
import { SearchPage } from './search.page';
import { SettingsPage } from './settings.page';
import { StopPage } from './stop.page';

interface Options {
  catalog?: FakeCatalog;
  locate?: () => Promise<LocateResult>;
}

function configure(options: Options = {}) {
  const catalog = options.catalog ?? fakeCatalog();
  TestBed.configureTestingModule({
    imports: [i18nTesting()],
    providers: [
      provideIonicAngular({}),
      provideRouter([
        { path: 'hat/:slug', component: LinePage },
        { path: 'durak/:slug', component: StopPage },
        { path: 'ara', component: SearchPage },
        { path: 'katki', component: ContributePage },
      ]),
      ...catalogTesting({ catalog, locate: options.locate }),
      // The interactive map never loads in unit tests; the page keeps the route sketch.
      { provide: MAP_LIBRARY_LOADER, useValue: () => Promise.reject(new Error('no WebGL')) },
    ],
  });
  return catalog;
}

async function render<T>(page: Type<T>, options: Options = {}): Promise<ComponentFixture<T>> {
  configure(options);
  const fixture = TestBed.createComponent(page);
  await settle(fixture);
  return fixture;
}

async function withCity(): Promise<void> {
  await TestBed.inject(CityStore).select(SAMPLE_CITY.slug);
}

const el = (fixture: { nativeElement: unknown }) => fixture.nativeElement as HTMLElement;
const text = (root: HTMLElement, selector: string) =>
  root.querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();
const cards = (root: HTMLElement) =>
  Array.from(root.querySelectorAll('iv-line-card')).map((c) => text(c as HTMLElement, '.plate'));

describe('tab pages', () => {
  beforeEach(() => localStorage.clear());

  it.each([
    [SearchPage, 'Nereye inecek var?'],
    [PlanPage, 'Nereden nereye?'],
    [FavoritesPage, 'Favoriler'],
    [ContributePage, 'Bu hat değişti mi? Söyle.'],
    [SettingsPage, 'Ayarlar'],
  ] as const)('%o renders its Turkish heading', async (page, heading) => {
    const fixture = await render<unknown>(page);
    expect(text(el(fixture), 'h1')).toBe(heading);
  });

  it('plan asks for a city before showing the form', async () => {
    const fixture = await render(PlanPage);
    expect(el(fixture).querySelector('form')).toBeNull();
    expect(text(el(fixture), 'iv-state h2')).toBe('Önce şehrini seç');
  });

  it('settings switches theme and language', async () => {
    const fixture = await render(SettingsPage);
    el(fixture).querySelector<HTMLButtonElement>('[data-value="dark"]')?.click();
    await fixture.whenStable();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(true);
    el(fixture).querySelector<HTMLButtonElement>('[data-value="light"]')?.click();
    await fixture.whenStable();
    expect(document.documentElement.classList.contains(DARK_CLASS)).toBe(false);

    el(fixture).querySelector<HTMLButtonElement>('[data-value="en"]')?.click();
    await new Promise((resolve) => setTimeout(resolve));
    await fixture.whenStable();
    expect(text(el(fixture), 'h1')).toBe('Settings');
    expect(el(fixture).querySelector('[data-value="en"]')?.getAttribute('aria-checked')).toBe(
      'true',
    );
  });

  it('not-found shows the error state and goes back to search', async () => {
    const fixture = await render(NotFoundPage);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    expect(el(fixture).querySelector('iv-state')?.getAttribute('role')).toBe('alert');
    el(fixture).querySelector<HTMLButtonElement>('iv-state button')?.click();
    expect(navigate).toHaveBeenCalledWith('/ara');
  });
});

describe('search page', () => {
  beforeEach(() => localStorage.clear());

  it('asks for a city first and picks the sample city from the sheet', async () => {
    const fixture = await render(SearchPage);
    expect(text(el(fixture), 'iv-state h2')).toBe('Önce şehrini seç');
    expect(el(fixture).querySelector('ion-searchbar')).toBeNull();
    el(fixture).querySelector<HTMLButtonElement>('iv-state button')?.click();
    await settle(fixture);
    const option = document.querySelector<HTMLButtonElement>(
      `[role="radio"][data-slug="${SAMPLE_CITY.slug}"]`,
    );
    expect(option?.textContent).toContain('[ÖRNEK] Test Şehri');
    expect(option?.textContent).toContain('Örnek veri');
    option?.click();
    await settle(fixture);
    expect(TestBed.inject(CityStore).selectedSlug()).toBe(SAMPLE_CITY.slug);
    expect(cards(el(fixture))).toEqual(['ORN-1', 'ORN-2', 'ORN-3']);
    expect(text(el(fixture), '.sample')).toContain('örnek veridir');
  });

  it('lists the API lines of the city, searches and filters by mode', async () => {
    const fixture = await render(SearchPage);
    await withCity();
    await settle(fixture);
    expect(cards(el(fixture))).toEqual(['ORN-1', 'ORN-2', 'ORN-3']);
    // Search results carry no fare, so no "fare unknown" chip is shown.
    expect(el(fixture).querySelector('iv-fare-chip')).toBeNull();

    const minibus = Array.from(el(fixture).querySelectorAll<HTMLButtonElement>('.filter')).find(
      (b) => b.textContent?.trim() === 'Minibüs',
    );
    minibus?.click();
    await settle(fixture);
    expect(cards(el(fixture))).toEqual(['ORN-2']);
    expect(minibus?.getAttribute('aria-pressed')).toBe('true');
  });

  it('shows matching stops with links to their page', async () => {
    const fixture = await render(SearchPage);
    await withCity();
    await settle(fixture);
    el(fixture)
      .querySelector('ion-searchbar')
      ?.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'Durak 2-2' } }));
    await settle(fixture);
    await settle(fixture);
    const link = el(fixture).querySelector<HTMLAnchorElement>('a.stop');
    expect(link?.textContent).toContain('[ÖRNEK] Durak 2-2');
    expect(link?.textContent).toContain('İşaretsiz durak');
    expect(link?.getAttribute('href')).toBe('/durak/ornek-durak-2-2?city=ornek-test-sehri');
  });

  it('shows the empty state for a query without matches and clears it', async () => {
    const fixture = await render(SearchPage);
    await withCity();
    await settle(fixture);
    el(fixture)
      .querySelector('ion-searchbar')
      ?.dispatchEvent(new CustomEvent('ionInput', { detail: { value: 'zzz' } }));
    await settle(fixture);
    expect(text(el(fixture), 'iv-state h2')).toBe('Bu aramaya uyan hat yok');
    el(fixture).querySelector<HTMLButtonElement>('iv-state button')?.click();
    await settle(fixture);
    expect(cards(el(fixture))).toHaveLength(3);
  });

  it('shows the offline state and retries', async () => {
    const catalog = fakeCatalog();
    const working = catalog.lines.impl;
    catalog.lines.impl = async () => Promise.reject(offline());
    const fixture = await render(SearchPage, { catalog });
    await withCity();
    await settle(fixture);
    expect(el(fixture).querySelector('iv-state')?.className).toContain('iv-state--offline');
    expect(text(el(fixture), 'iv-state h2')).toBe('İnternet yok');
    catalog.lines.impl = working;
    el(fixture).querySelector<HTMLButtonElement>('iv-state button')?.click();
    await settle(fixture);
    expect(cards(el(fixture))).toHaveLength(3);
  });

  it('lists nearby lines and explains a refused location permission', async () => {
    const fixture = await render(SearchPage);
    await withCity();
    await settle(fixture);
    el(fixture).querySelector<HTMLButtonElement>('.locate')?.click();
    await settle(fixture);
    const nearby = el(fixture).querySelector('.nearby') as HTMLElement;
    expect(cards(nearby)).toEqual(['ORN-1', 'ORN-3']);
    expect(text(nearby, '.meta')).toMatch(/\[ÖRNEK\] Durak 1-5\s*\d+ m/);

    TestBed.resetTestingModule();
    localStorage.clear();
    const denied = await render(SearchPage, { locate: async () => ({ kind: 'denied' }) });
    await withCity();
    await settle(denied);
    el(denied).querySelector<HTMLButtonElement>('.locate')?.click();
    await settle(denied);
    expect(text(el(denied), '.nearby [role="alert"]')).toContain('Konum izni verilmedi');
  });

  it('a starred result appears in favourites and opens its line page', async () => {
    const search = await render(SearchPage);
    await withCity();
    await settle(search);
    el(search).querySelector<HTMLButtonElement>('iv-line-card .star')?.click();
    await settle(search);
    const favorites = TestBed.createComponent(FavoritesPage);
    await settle(favorites);
    expect(cards(el(favorites))).toEqual(['ORN-1']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    el(favorites).querySelector<HTMLButtonElement>('iv-line-card .main')?.click();
    expect(navigate).toHaveBeenCalledWith(['/hat', 'ornek-hat-1'], {
      queryParams: { city: SAMPLE_CITY.slug },
    });
  });

  it('favourites starts with the empty state', async () => {
    const fixture = await render(FavoritesPage);
    expect(text(el(fixture), 'iv-state h2')).toBe('Henüz favori hat yok');
  });
});

async function openDetail(url: string, options: Options = {}) {
  localStorage.clear();
  const catalog = configure(options);
  const harness = await RouterTestingHarness.create();
  await harness.navigateByUrl(url);
  await settle(harness.fixture);
  return { harness, catalog, root: harness.routeNativeElement as HTMLElement };
}

describe('line page', () => {
  it('shows the route, ordered stops, fare with its date, hours, payment and freshness', async () => {
    const { root, catalog } = await openDetail('/hat/ornek-hat-1?city=ornek-test-sehri');
    expect(catalog.line.calls[0]?.slice(0, 2)).toEqual(['ornek-hat-1', 'ornek-test-sehri']);
    expect(text(root, 'h1')).toBe('ORN-1 [ÖRNEK] Hat ORN-1');
    expect(text(root, '.hero .mode')).toBe('Dolmuş');
    expect(
      Array.from(root.querySelectorAll('.hero .ends .stop')).map((n) => n.textContent?.trim()),
    ).toEqual(['[ÖRNEK] Durak 1-1', '[ÖRNEK] Durak 1-5']);
    // The strip diagram comes first: one dot per stop on a cased rail; the map waits for a tap.
    expect(root.querySelectorAll('iv-route-strip circle.node')).toHaveLength(5);
    expect(root.querySelector('iv-route-strip path.casing')).not.toBeNull();
    expect(root.querySelector('iv-map, iv-route-sketch')).toBeNull();
    expect(text(root, '.facts .iv-ticket__amount')).toBe('₺25,00');
    expect(text(root, '.facts .iv-ticket__note')).toBe('Son güncelleme: 1 Ekim 2026');
    expect(text(root, '.facts')).toContain('[ÖRNEK] 06:00-23:00');
    expect(text(root, '.pay')).toBe('Nakit');
    expect(
      Array.from(root.querySelectorAll('iv-stop-sequence .name')).map((n) => n.textContent),
    ).toEqual([1, 2, 3, 4, 5].map((c) => `[ÖRNEK] Durak 1-${c}`));
    expect(text(root, '.trust')).toContain('Henüz doğrulanmadı');
    expect(text(root, '.trust')).toContain('0 katkıcı');
  });

  it('opens the map view on request and returns to the diagram', async () => {
    const { root, harness } = await openDetail('/hat/ornek-hat-1?city=ornek-test-sehri');
    const toggle = root.querySelector<HTMLButtonElement>('.view-switch .map-toggle');
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');
    toggle?.click();
    await settle(harness.fixture);
    expect(toggle?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector('.map iv-map, .map iv-route-sketch')).not.toBeNull();
    expect(root.querySelector('iv-route-strip')).toBeNull();
    root.querySelector<HTMLButtonElement>('.view-switch button')?.click();
    await settle(harness.fixture);
    expect(root.querySelectorAll('iv-route-strip circle.node')).toHaveLength(5);
  });

  it('toggles the favourite, opens a stop and routes the change report to Katkı', async () => {
    const { root, harness } = await openDetail('/hat/ornek-hat-1?city=ornek-test-sehri');
    root.querySelector<HTMLButtonElement>('.hero .star')?.click();
    await settle(harness.fixture);
    expect(root.querySelector('.hero .star')?.getAttribute('aria-pressed')).toBe('true');
    const prefs = TestBed.inject(PREFERENCE_STORE) as MemoryPreferences;
    expect(JSON.parse(prefs.values.get('iv.favorites') ?? '[]')).toEqual([
      {
        city: SAMPLE_CITY.slug,
        slug: 'ornek-hat-1',
        code: 'ORN-1',
        name: '[ÖRNEK] Hat ORN-1',
        mode: 'dolmus',
        lineId: 'line-1',
      },
    ]);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    root.querySelectorAll<HTMLButtonElement>('iv-stop-sequence button')[4]?.click();
    expect(navigate).toHaveBeenCalledWith(['/durak', 'ornek-durak-1-5'], {
      queryParams: { city: SAMPLE_CITY.slug },
    });
    root.querySelector<HTMLButtonElement>('.report .iv-button')?.click();
    expect(navigate).toHaveBeenLastCalledWith(['/katki'], {
      queryParams: { hat: 'ornek-hat-1', city: SAMPLE_CITY.slug },
    });
  });

  it('renders user-supplied text as text, never as markup', async () => {
    const catalog = fakeCatalog();
    const payload = '<img src=x onerror="window.__ivXss=1">';
    catalog.line.impl = async () =>
      sampleLineDetail({
        name: payload,
        hail_notes: `<script>window.__ivXss=1</script>${payload}`,
        payment_methods: [payload],
        stops: sampleLineDetail()
          .stops.slice(0, 1)
          .map((stop) => ({ ...stop, name: payload })),
      });
    const { root } = await openDetail('/hat/ornek-hat-1?city=ornek-test-sehri', { catalog });
    expect(text(root, 'h1')).toBe(`ORN-1 ${payload}`);
    expect(text(root, '.notes')).toContain('<script>');
    expect(text(root, '.pay')).toBe(payload);
    expect(text(root, 'iv-stop-sequence .name')).toBe(payload);
    expect(root.querySelector('img, script')).toBeNull();
    expect((window as { __ivXss?: number }).__ivXss).toBeUndefined();
  });

  it('shows not-found for an unknown line and offline without a connection', async () => {
    const first = await openDetail('/hat/yok?city=ornek-test-sehri');
    expect(text(first.root, 'iv-state h2')).toBe('Bu hat bulunamadı');

    TestBed.resetTestingModule();
    const catalog = fakeCatalog();
    catalog.line.impl = async () => Promise.reject(offline());
    const second = await openDetail('/hat/ornek-hat-1?city=ornek-test-sehri', { catalog });
    expect(text(second.root, 'iv-state h2')).toBe('İnternet yok');
  });

  it('uses the stored city when the link has none', async () => {
    const prefsCatalog = fakeCatalog();
    configure({ catalog: prefsCatalog });
    await TestBed.inject(CityStore).select(SAMPLE_CITY.slug);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/hat/ornek-hat-1');
    await settle(harness.fixture);
    expect(prefsCatalog.line.calls[0]?.slice(0, 2)).toEqual(['ornek-hat-1', SAMPLE_CITY.slug]);
  });
});

describe('stop page', () => {
  it('lists the lines serving the stop', async () => {
    const { root, catalog } = await openDetail('/durak/ornek-durak-1-5?city=ornek-test-sehri');
    expect(catalog.stop.calls[0]?.slice(0, 2)).toEqual(['ornek-durak-1-5', 'ornek-test-sehri']);
    expect(text(root, 'h1')).toBe('[ÖRNEK] Durak 1-5');
    expect(text(root, '.iv-kicker')).toBe('Resmî durak');
    expect(cards(root)).toEqual(['ORN-1', 'ORN-3']);
  });

  it('shows not-found for an unknown stop', async () => {
    const { root } = await openDetail('/durak/yok?city=ornek-test-sehri');
    expect(text(root, 'iv-state h2')).toBe('Bu durak bulunamadı');
  });
});

describe('detail routes', () => {
  it('lazy-loads the line and stop pages inside the tab shell', async () => {
    const children = appRoutes[0]?.children ?? [];
    const line = children.find((r) => r.path === 'hat/:slug');
    const stop = children.find((r) => r.path === 'durak/:slug');
    expect(await line?.loadComponent?.()).toBe(LinePage);
    expect(await stop?.loadComponent?.()).toBe(StopPage);
  });
});
