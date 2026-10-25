import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { PublicApiClient, PublicApiResult } from '../data/public-api.client';
import { StopPairsOut } from '../content/public-types';
import { RouteSearchComponent } from './route-search.component';

const pair = {
  from_stop: { slug: 'moda', name: 'Moda' },
  to_stop: { slug: 'bostanci', name: 'Bostancı' },
  shared_line_count: 1,
};
const response: PublicApiResult<StopPairsOut> = {
  ok: true,
  data: { city: 'istanbul', basis: 'shared_published_lines', pairs: [pair] },
};

function setup() {
  const get = vi.fn();
  TestBed.configureTestingModule({
    imports: [RouteSearchComponent],
    providers: [provideRouter([]), { provide: PublicApiClient, useValue: { get } }],
  });
  const fixture = TestBed.createComponent(RouteSearchComponent);
  fixture.componentRef.setInput('cities', [{ slug: 'istanbul', name: 'İstanbul' }]);
  fixture.detectChanges();
  const element = fixture.nativeElement as HTMLElement;
  const select = (id: string, value: string) => {
    const control = element.querySelector<HTMLSelectElement>('#' + id);
    if (!control) throw new Error('Missing select');
    control.value = value;
    control.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  };
  return { fixture, element, get, select };
}

afterEach(() => TestBed.resetTestingModule());

describe('route search sign', () => {
  it('opens the published route selected through both stop fields', async () => {
    const { fixture, element, get, select } = setup();
    get.mockResolvedValue(response);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    select('route-city', 'istanbul');
    await fixture.whenStable();
    fixture.detectChanges();
    select('route-from', 'moda');
    select('route-to', 'bostanci');
    expect(element.querySelector('button')?.disabled).toBe(false);
    element.querySelector('form')?.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(navigate).toHaveBeenCalledWith('/istanbul/rota/moda-bostanci');
    expect(get).toHaveBeenCalledWith(
      '/cities/istanbul/stop-pairs',
      { limit: 200 },
      expect.any(Function),
    );
  });

  it('ignores a response arriving after the city selection was cleared', async () => {
    const { fixture, element, get, select } = setup();
    let finish!: (value: PublicApiResult<StopPairsOut>) => void;
    get.mockReturnValue(
      new Promise<PublicApiResult<StopPairsOut>>((resolve) => {
        finish = resolve;
      }),
    );
    select('route-city', 'istanbul');
    select('route-city', '');
    finish(response);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element.querySelector<HTMLSelectElement>('#route-from')?.disabled).toBe(true);
    expect(element.querySelectorAll('#route-from option')).toHaveLength(1);
  });

  it('shows an error notice with an icon and keeps route submission disabled', async () => {
    const { fixture, element, get, select } = setup();
    get.mockResolvedValue({ ok: false, kind: 'unavailable', status: 503, code: null });
    select('route-city', 'istanbul');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element.querySelector('[role="alert"]')?.textContent).toContain('Duraklar yüklenemedi');
    expect(element.querySelector('[role="alert"] svg')).not.toBeNull();
    expect(element.querySelector('button')?.disabled).toBe(true);
  });
});
