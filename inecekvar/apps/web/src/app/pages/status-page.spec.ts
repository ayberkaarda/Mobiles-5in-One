import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { DEFAULT_PUBLIC_WEB_CONFIG, PUBLIC_WEB_CONFIG } from '../public-config';
import { SeoService } from '../seo/seo.service';
import { NotFoundPage } from './not-found.page';
import { StatusPageComponent } from './status-page.component';

let seo: SeoService | undefined;

afterEach(() => {
  seo?.reset();
  seo = undefined;
  TestBed.resetTestingModule();
});

function setup(path = '/olmayan-sayfa?ref=1#baslik') {
  const response: ResponseInit = { status: 200 };
  TestBed.configureTestingModule({
    imports: [StatusPageComponent],
    providers: [
      provideRouter([{ path: '**', component: NotFoundPage }]),
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: RESPONSE_INIT, useValue: response },
      { provide: PUBLIC_WEB_CONFIG, useValue: DEFAULT_PUBLIC_WEB_CONFIG },
    ],
  });
  seo = TestBed.inject(SeoService);
  vi.spyOn(TestBed.inject(Router), 'url', 'get').mockReturnValue(path);
  return response;
}

describe('status page', () => {
  it.each([
    ['not-found', 404, 'Sayfa bulunamadı'],
    ['unavailable', 503, 'Şu anda yanıt veremiyoruz'],
  ] as const)('renders %s with its server status and noindex metadata', (kind, status, heading) => {
    const response = setup();
    const fixture = TestBed.createComponent(StatusPageComponent);
    fixture.componentRef.setInput('kind', kind);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(response.status).toBe(status);
    expect(element.querySelector('h1')?.textContent).toBe(heading);
    expect(element.querySelector('p')?.textContent?.trim().length).toBeGreaterThan(0);
    const link = element.querySelector('a');
    expect(link?.textContent).toBe('Ana sayfaya dön');
    expect(link?.getAttribute('href')).toBe('/');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,nofollow',
    );
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      DEFAULT_PUBLIC_WEB_CONFIG.canonicalOrigin + '/olmayan-sayfa',
    );
    if (status === 503) {
      expect(new Headers(response.headers).get('Retry-After')).toBe('120');
    }
  });

  it.each(['//evil.example', '/a/../b', '/a\\b', 'https://evil.example', ''])(
    'falls back to the home canonical for an invalid path: %s',
    (path) => {
      setup(path);
      const fixture = TestBed.createComponent(StatusPageComponent);
      fixture.componentRef.setInput('kind', 'not-found');
      fixture.detectChanges();
      expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
        DEFAULT_PUBLIC_WEB_CONFIG.canonicalOrigin + '/',
      );
    },
  );

  it('uses the destination path during initial router activation', async () => {
    const response = setup('/');
    // The real router URL must drive this case, not the stub from setup().
    vi.restoreAllMocks();
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/eksik?ref=1', NotFoundPage);
    expect(response.status).toBe(404);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Sayfa bulunamadı');
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      DEFAULT_PUBLIC_WEB_CONFIG.canonicalOrigin + '/eksik',
    );
  });
});
