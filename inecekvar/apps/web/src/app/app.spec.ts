import { TestBed } from '@angular/core/testing';
import { Home } from './home/home';
import { DEFAULT_PUBLIC_WEB_CONFIG, PUBLIC_WEB_CONFIG } from './public-config';
import { JsonLdService } from './seo/json-ld.service';
import { SeoService } from './seo/seo.service';

describe('Home', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Home],
      providers: [{ provide: PUBLIC_WEB_CONFIG, useValue: DEFAULT_PUBLIC_WEB_CONFIG }],
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
});
