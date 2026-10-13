import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CitySceneComponent } from './city-scene.component';
import { DestinationSignComponent } from './destination-sign.component';
import { StopSequenceComponent } from './stop-sequence.component';
import { StopSignComponent } from './stop-sign.component';
import { TicketComponent } from './ticket.component';

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

@Component({
  imports: [
    CitySceneComponent,
    DestinationSignComponent,
    StopSequenceComponent,
    StopSignComponent,
    TicketComponent,
  ],
  template: `
    <iv-destination-sign
      code="ORN-1"
      mode="Dolmuş"
      from="<b>Rıhtım</b>"
      to="İskele"
      fromLabel="Kalkış"
      toLabel="Son durak"
    >
      <button slot="action" class="star">*</button>
      <h1>Hat</h1>
    </iv-destination-sign>
    <iv-ticket stub="Ücret" amount="₺25,00" note="Son güncelleme: 1 Ekim 2026" />
    <iv-stop-sign><h1 class="stop">Moda</h1></iv-stop-sign>
    <iv-stop-sequence
      label="Duraklar"
      [stops]="[
        { slug: 'a', name: 'A', link: ['/x', 'durak', 'a'], tick: '1' },
        { slug: 'b', name: 'B', link: ['/x', 'durak', 'b'], tick: '2' },
      ]"
    />
    <iv-city-scene [still]="true" />
  `,
})
class Host {}

describe('sign components', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('renders the destination sign with its placard, ends, heading and action', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const sign = (fixture.nativeElement as HTMLElement).querySelector('iv-destination-sign');
    expect(squash(sign?.querySelector('.plate')?.textContent)).toBe('ORN-1');
    expect(sign?.querySelector('.plate')?.getAttribute('aria-hidden')).toBe('true');
    expect(getComputedStyle(sign?.querySelector('.plate') as Element).whiteSpace).toBe('nowrap');
    expect(Array.from(sign?.querySelectorAll('.stop') ?? []).map((s) => s.textContent)).toEqual([
      '<b>Rıhtım</b>',
      'İskele',
    ]);
    expect(sign?.querySelector('b')).toBeNull();
    expect(sign?.querySelector('.action .star')).not.toBeNull();
    expect(squash(sign?.querySelector('h1')?.textContent)).toBe('Hat');
  });

  it('reads the ticket as one phrase and keeps the stub for sight only', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const ticket = (fixture.nativeElement as HTMLElement).querySelector('iv-ticket');
    expect(ticket?.classList.contains('iv-ticket')).toBe(true);
    expect(ticket?.querySelector('.iv-ticket__stub')?.getAttribute('aria-hidden')).toBe('true');
    expect(squash(ticket?.querySelector('.iv-ticket__body')?.textContent)).toBe(
      'Ücret: ₺25,00 Son güncelleme: 1 Ekim 2026',
    );
  });

  it('turns stop rows into links when they carry one, in an ordered list', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const list = el.querySelector('iv-stop-sequence ol');
    expect(list?.getAttribute('aria-label')).toBe('Duraklar');
    const links = Array.from(list?.querySelectorAll('li a') ?? []);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/x/durak/a', '/x/durak/b']);
    // The stop number sits beside the link, so the link is named by the stop alone.
    expect(links.map((a) => squash(a.textContent))).toEqual(['A', 'B']);
    expect(list?.querySelector('button')).toBeNull();
    expect(squash(list?.querySelector('.tick')?.textContent)).toBe('1');
  });

  it('keeps the illustrations decorative', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('iv-city-scene svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('iv-city-scene')?.classList.contains('still')).toBe(true);
    expect(el.querySelector('iv-stop-sign svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(squash(el.querySelector('iv-stop-sign h1')?.textContent)).toBe('Moda');
  });
});
