import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { HomeData, PageData } from './content/page-data';
import { cityData } from './content/test-data';
import { Home } from './home/home';
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
