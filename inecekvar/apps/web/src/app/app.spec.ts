import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { HomeData, PageData } from './content/page-data';
import { cityData } from './content/test-data';
import { FACTS } from '../content/facts';
import { featuredCity, Home } from './home/home';
import { DEFAULT_PUBLIC_WEB_CONFIG, PUBLIC_WEB_CONFIG } from './public-config';
import { JsonLdService } from './seo/json-ld.service';
import { SeoService } from './seo/seo.service';

describe('Home', () => {
  let resolved: BehaviorSubject<{ page: PageData<HomeData> }>;
  let response: ResponseInit;
  beforeEach(async () => {
    resolved = new BehaviorSubject<{ page: PageData<HomeData> }>({
      page: { state: 'ok', cities: [cityData()] },
    });
    response = { status: 200 };
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { data: resolved } },
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: RESPONSE_INIT, useValue: response },
        { provide: PUBLIC_WEB_CONFIG, useValue: DEFAULT_PUBLIC_WEB_CONFIG },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.inject(SeoService).reset();
    TestBed.inject(JsonLdService).clearAll();
    TestBed.resetTestingModule();
  });

  it('renders the brand name and the Turkish tagline', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('h1')?.textContent).toContain('İnecek Var');
    expect(element.querySelector('.tagline')?.textContent).toContain(
      'Dolmuş nereden geçer? Mahalle bilir.',
    );
  });

  it('has banner, main and footer landmarks with the internal content links', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelectorAll('header')).toHaveLength(1);
    expect(element.querySelectorAll('main#icerik')).toHaveLength(1);
    expect(element.querySelectorAll('footer')).toHaveLength(1);
    expect(element.querySelector('main header, main footer')).toBeNull();
    expect(element.querySelector('a.skip')?.getAttribute('href')).toBe('#icerik');
    const hrefs = (selector: string): string[] =>
      Array.from(element.querySelectorAll<HTMLAnchorElement>(selector)).map(
        (link) => link.getAttribute('href') ?? '',
      );
    expect(hrefs('header nav[aria-label="Site"] a')).toEqual(['/rehber', '/sss', '/veri']);
    expect(hrefs('footer nav a')).toEqual(['/rehber', '/sss', '/veri', '/hakkinda', '/gizlilik']);
    expect(hrefs('main a[href^="/rehber/"]')).toEqual([
      '/rehber/cevrimdisi-sehir-paketi-nasil-kullanilir',
      '/rehber/hat-bilgisi-nasil-dogrulanir',
    ]);
  });

  it('leads with the description and calls to the sample city and the app', async () => {
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    await fixture.whenStable();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.lead')?.textContent?.trim()).toBe(FACTS.description);
    const primary = element.querySelector<HTMLAnchorElement>('a.btn.primary');
    expect(primary?.textContent).toContain('Örnek şehri gez');
    expect(primary?.getAttribute('href')).toBe('/ornek-sehir');
    expect(element.querySelector('a.btn.secondary')?.getAttribute('href')).toBe(
      'https://app.inecekvar.app/',
    );
    const city = element.querySelector('#cities-title + ul .city');
    expect(city?.querySelector('a')?.textContent).toBe('Örnek Şehir');
    expect(city?.querySelector('.badge')?.textContent).toBe('örnek veri');
    expect(element.querySelectorAll('.steps li h3')).toHaveLength(3);
  });

  it('features the first city with published lines', () => {
    const empty = cityData({ slug: 'bos', published_line_count: 0 });
    const full = cityData({ slug: 'dolu', is_sample: false });
    expect(featuredCity([empty, full])?.slug).toBe('dolu');
    expect(featuredCity([empty])?.slug).toBe('bos');
    expect(featuredCity([])).toBeNull();
  });

  it('renders an unavailable home as 503 and clears JSON-LD', () => {
    resolved.next({ page: { state: 'unavailable' } });
    const fixture = TestBed.createComponent(Home);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('iv-status-page')?.textContent).toContain(
      'Şu anda yanıt veremiyoruz',
    );
    expect(response.status).toBe(503);
    expect(new Headers(response.headers).get('Retry-After')).toBe('120');
    expect(document.head.querySelector('script[data-iv-jsonld="content"]')).toBeNull();
  });
});
