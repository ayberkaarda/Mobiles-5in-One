import { PLATFORM_ID, RESPONSE_INIT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HealthStatus, isHealthStatus } from '@inecekvar/domain';
import { PublicApiClient, PublicApiResult } from '../data/public-api.client';
import { DEFAULT_PUBLIC_WEB_CONFIG, PUBLIC_WEB_CONFIG } from '../public-config';
import { SeoService } from '../seo/seo.service';
import { DurumPage, durumResolver } from './durum.page';

let seo: SeoService | undefined;

afterEach(() => {
  seo?.reset();
  seo = undefined;
  TestBed.resetTestingModule();
});

function setup(result: PublicApiResult<HealthStatus>) {
  const response: ResponseInit = { status: 200 };
  const get = vi.fn(() => Promise.resolve(result));
  TestBed.configureTestingModule({
    providers: [
      provideRouter([{ path: 'durum', component: DurumPage, resolve: { health: durumResolver } }]),
      { provide: PublicApiClient, useValue: { get } },
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: RESPONSE_INIT, useValue: response },
      { provide: PUBLIC_WEB_CONFIG, useValue: DEFAULT_PUBLIC_WEB_CONFIG },
    ],
  });
  seo = TestBed.inject(SeoService);
  return { response, get };
}

describe('service status resolver and page', () => {
  it('resolves guarded health data and renders the available service', async () => {
    const { get, response } = setup({ ok: true, data: { status: 'ok' } });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/durum', DurumPage);
    expect(get).toHaveBeenCalledExactlyOnceWith('/health', undefined, isHealthStatus);
    expect(response.status).toBe(200);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Hizmet çalışıyor');
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,nofollow',
    );
  });

  it.each([
    { ok: false, kind: 'unavailable', status: 0, code: null },
    { ok: false, kind: 'unavailable', status: 503, code: 'unavailable' },
    { ok: false, kind: 'not_found', status: 404, code: 'not_found' },
  ] as const)('renders a failed health check as 503: $status', async (result) => {
    const { get, response } = setup(result);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/durum', DurumPage);
    expect(get).toHaveBeenCalledExactlyOnceWith('/health', undefined, isHealthStatus);
    expect(response.status).toBe(503);
    expect(new Headers(response.headers).get('Retry-After')).toBe('120');
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe(
      'Şu anda yanıt veremiyoruz',
    );
    expect(document.head.querySelector('meta[name="robots"]')?.getAttribute('content')).toBe(
      'noindex,nofollow',
    );
  });
});
