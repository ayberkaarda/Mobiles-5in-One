import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { BehaviorSubject } from 'rxjs';
import { LineData, PageData } from '../content/page-data';
import { cityData, lineData, stopData } from '../content/test-data';
import { DEFAULT_PUBLIC_WEB_CONFIG, PUBLIC_WEB_CONFIG } from '../public-config';
import { JsonLdService } from '../seo/json-ld.service';
import { SeoService } from '../seo/seo.service';
import { lineAppLinks, LinePage } from './line.page';

let seo: SeoService | undefined;
let jsonLd: JsonLdService | undefined;

afterEach(() => {
  seo?.reset();
  jsonLd?.clearAll();
  seo = undefined;
  jsonLd = undefined;
  TestBed.resetTestingModule();
});
describe('line page rendering', () => {
  it('renders numeric SVG attributes, escaped stop text and app links, and updates reused pages', async () => {
    const payload = '<img src=x onerror=alert(1)>';
    const city = cityData();
    const line = lineData({ stops: [stopData('ilk', payload), stopData('son', 'Son')] });
    const resolved = new BehaviorSubject<{ page: PageData<LineData> }>({
      page: { state: 'ok', city, line },
    });
    TestBed.configureTestingModule({
      imports: [LinePage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { data: resolved } },
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: RESPONSE_INIT, useValue: { status: 200 } },
        {
          provide: PUBLIC_WEB_CONFIG,
          useValue: { ...DEFAULT_PUBLIC_WEB_CONFIG, appOrigin: 'https://app.example' },
        },
      ],
    });
    seo = TestBed.inject(SeoService);
    jsonLd = TestBed.inject(JsonLdService);
    const fixture = TestBed.createComponent(LinePage);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('svg path')?.getAttribute('d')).toMatch(
      /^M [-0-9. ]+( L [-0-9. ]+)*$/,
    );
    expect(element.querySelector('ol')?.textContent).toContain(payload);
    expect(element.querySelector('img')).toBeNull();
    const links = [...element.querySelectorAll<HTMLAnchorElement>('.actions a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://app.example/katki?hat=ornek-hat&city=ornek-sehir',
      'https://app.example/hat/ornek-hat?city=ornek-sehir',
    ]);
    expect(links.every((link) => link.rel === 'nofollow')).toBe(true);
    expect(element.querySelector('iv-line-map button')?.textContent).toBe(
      'Haritayı etkileşimli aç',
    );
    expect(element.querySelector('canvas')).toBeNull();
    resolved.next({
      page: { state: 'ok', city, line: lineData({ slug: 'ikinci-hat', name: 'İkinci Hat' }) },
    });
    fixture.detectChanges();
    await fixture.whenStable();
    expect(element.querySelector('h1')?.textContent).toContain('İkinci Hat');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain(
      '/hat/ikinci-hat',
    );
    fixture.destroy();
    expect(document.head.querySelector('script[data-iv-jsonld="content"]')).toBeNull();
  });
  it.each([
    { state: 'not_found', status: 404, heading: 'Sayfa bulunamadı' },
    { state: 'unavailable', status: 503, heading: 'Şu anda yanıt veremiyoruz' },
  ] as const)('sets status $status for $state', ({ state, status, heading }) => {
    const resolved = new BehaviorSubject<{ page: PageData<LineData> }>({
      page: { state: 'ok', city: cityData(), line: lineData() },
    });
    const response: ResponseInit = { status: 200 };
    TestBed.configureTestingModule({
      imports: [LinePage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { data: resolved } },
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: RESPONSE_INIT, useValue: response },
        { provide: PUBLIC_WEB_CONFIG, useValue: DEFAULT_PUBLIC_WEB_CONFIG },
      ],
    });
    seo = TestBed.inject(SeoService);
    jsonLd = TestBed.inject(JsonLdService);
    const fixture = TestBed.createComponent(LinePage);
    fixture.detectChanges();
    expect(document.head.querySelector('script[data-iv-jsonld="content"]')).not.toBeNull();
    resolved.next({ page: { state } });
    fixture.detectChanges();
    expect(response.status).toBe(status);
    expect((fixture.nativeElement as HTMLElement).querySelector('h1')?.textContent).toBe(heading);
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,nofollow',
    );
    expect(document.head.querySelector('script[data-iv-jsonld="content"]')).toBeNull();
  });
  it('encodes app query values through URL search parameters', () => {
    const links = lineAppLinks('https://app.example', 'şehir & yer', 'hat & durak');
    expect(links.contribute).toBe(
      'https://app.example/katki?hat=hat+%26+durak&city=%C5%9Fehir+%26+yer',
    );
    expect(new URL(links.open).searchParams.get('city')).toBe('şehir & yer');
    expect(new URL(links.contribute).searchParams.get('hat')).toBe('hat & durak');
  });
  it('updates the error canonical when the same page is reused', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          {
            path: ':sehir/hat/:slug',
            component: LinePage,
            resolve: { page: () => ({ state: 'unavailable' }) },
          },
        ]),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: RESPONSE_INIT, useValue: { status: 200 } },
        { provide: PUBLIC_WEB_CONFIG, useValue: DEFAULT_PUBLIC_WEB_CONFIG },
      ],
    });
    seo = TestBed.inject(SeoService);
    jsonLd = TestBed.inject(JsonLdService);
    const harness = await RouterTestingHarness.create();
    const first = await harness.navigateByUrl('/ornek-sehir/hat/ilk', LinePage);
    const second = await harness.navigateByUrl('/ornek-sehir/hat/son', LinePage);
    expect(second).toBe(first);
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      DEFAULT_PUBLIC_WEB_CONFIG.canonicalOrigin + '/ornek-sehir/hat/son',
    );
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,nofollow',
    );
  });
});
