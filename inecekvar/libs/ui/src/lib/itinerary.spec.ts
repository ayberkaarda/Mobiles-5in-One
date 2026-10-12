import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ItineraryCardComponent, ItinerarySummary } from './itinerary-card.component';
import { ItineraryStep, ItineraryStepsComponent } from './itinerary-steps.component';

@Component({
  imports: [ItineraryCardComponent, ItineraryStepsComponent],
  template: `
    <iv-itinerary-card
      [summary]="summary()"
      [selected]="selected()"
      (selectedChange)="selected.set(!selected())"
    />
    <iv-itinerary-steps [steps]="steps()" label="Adımlar" />
  `,
})
class Host {
  readonly selected = signal(false);
  readonly summary = signal<ItinerarySummary>({
    title: 'Seçenek 1',
    legs: [
      { kind: 'walk', label: '120 m' },
      { kind: 'ride', code: 'ORN-1', name: '<img src=x onerror=alert(1)>' },
      { kind: 'ride', code: 'ORN-2', name: 'Hat 2' },
    ],
    duration: '≈ 18 dk',
    fare: '≈ ₺50,00',
    transfers: '1 aktarma',
    walk: '120 m yürüme',
  });
  readonly steps = signal<ItineraryStep[]>([
    { kind: 'walk', title: '120 m yürü: <b>Durak</b>', detail: 'Başlangıçtan' },
    { kind: 'ride', code: 'ORN-1', title: 'ORN-1 hattına bin', detail: 'A → B, 3 durak' },
  ]);
}

const clean = (value: string | null | undefined) => value?.replace(/\s+/g, ' ').trim();

describe('itinerary components', () => {
  it('renders the leg chain, facts and toggles selection', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const plates = Array.from(root.querySelectorAll('iv-itinerary-card .plate'));
    expect(plates.map((p) => p.firstChild?.textContent?.trim())).toEqual(['ORN-1', 'ORN-2']);
    expect(clean(root.querySelector('.walk')?.textContent)).toBe('120 m');
    expect(root.querySelectorAll('.sep')).toHaveLength(2);
    expect(Array.from(root.querySelectorAll('.fact')).map((f) => clean(f.textContent))).toEqual([
      '1 aktarma',
      '120 m yürüme',
      '≈ ₺50,00',
    ]);
    const button = root.querySelector<HTMLButtonElement>('iv-itinerary-card button');
    expect(button?.getAttribute('aria-pressed')).toBe('false');
    button?.click();
    await fixture.whenStable();
    expect(button?.getAttribute('aria-pressed')).toBe('true');
  });

  it('renders step and line names as text only', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('img, b')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=alert(1)>');
    const items = root.querySelectorAll('iv-itinerary-steps li');
    expect(items).toHaveLength(2);
    expect(root.querySelector('ol')?.getAttribute('aria-label')).toBe('Adımlar');
    expect(clean(items[1]?.querySelector('.plate')?.textContent)).toBe('ORN-1');
    expect(items[0]?.querySelector('.ring')).not.toBeNull();
  });
});
