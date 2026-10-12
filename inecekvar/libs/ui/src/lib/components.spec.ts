import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LineMode } from '@inecekvar/domain';
import { FareChipComponent } from './fare-chip.component';
import { LineCardComponent, LineCardLabels } from './line-card.component';
import { ModeChipComponent } from './mode-chip.component';
import { StateComponent, StateKind } from './state.component';

const LABELS: LineCardLabels = {
  mode: 'Dolmuş',
  fare: 'Ücret',
  fareFree: 'Ücretsiz',
  fareUnknown: 'Ücret bilinmiyor',
  favoriteAdd: 'Favorilere ekle',
  favoriteRemove: 'Favorilerden çıkar',
};

const squash = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

@Component({
  imports: [FareChipComponent, ModeChipComponent],
  template: `
    <iv-fare-chip
      [fareMinor]="fare()"
      freeLabel="Ücretsiz"
      unknownLabel="Bilinmiyor"
      srLabel="Ücret"
    />
    <iv-mode-chip [mode]="mode()" [label]="modeLabel()" />
  `,
})
class ChipsHost {
  readonly fare = signal<number | null>(2750);
  readonly mode = signal<LineMode>('dolmus');
  readonly modeLabel = signal('Dolmuş');
}

describe('FareChipComponent and ModeChipComponent', () => {
  it('formats paid, free and unknown fares', async () => {
    const fixture = TestBed.createComponent(ChipsHost);
    await fixture.whenStable();
    const chip = () => (fixture.nativeElement as HTMLElement).querySelector('iv-fare-chip');
    expect(squash(chip()?.textContent).replace(/\s/g, '')).toBe('Ücret:₺27,50');
    expect(chip()?.getAttribute('data-state')).toBe('paid');

    fixture.componentInstance.fare.set(0);
    await fixture.whenStable();
    expect(squash(chip()?.textContent)).toBe('Ücret: Ücretsiz');
    expect(chip()?.classList.contains('iv-fare--free')).toBe(true);

    fixture.componentInstance.fare.set(null);
    await fixture.whenStable();
    expect(squash(chip()?.textContent)).toBe('Ücret: Bilinmiyor');
    expect(chip()?.getAttribute('data-state')).toBe('unknown');
  });

  it('tags the mode chip with a per-mode class and the given label', async () => {
    const fixture = TestBed.createComponent(ChipsHost);
    await fixture.whenStable();
    const chip = () => (fixture.nativeElement as HTMLElement).querySelector('iv-mode-chip');
    expect(chip()?.classList.contains('iv-chip--dolmus')).toBe(true);
    expect(squash(chip()?.textContent)).toBe('Dolmuş');

    fixture.componentInstance.mode.set('servis');
    fixture.componentInstance.modeLabel.set('Servis');
    await fixture.whenStable();
    expect(chip()?.classList.contains('iv-chip--servis')).toBe(true);
    expect(chip()?.classList.contains('iv-chip--dolmus')).toBe(false);
    expect(chip()?.getAttribute('data-mode')).toBe('servis');
    expect(squash(chip()?.textContent)).toBe('Servis');
  });
});

@Component({
  imports: [LineCardComponent],
  template: `
    <iv-line-card
      code="ORN-1"
      name="[ÖRNEK] Hat ORN-1"
      mode="dolmus"
      [meta]="['5 durak', '06:00-23:00']"
      [fareMinor]="2500"
      [labels]="labels"
      [favorite]="favorite()"
      (favoriteToggle)="toggles = toggles + 1"
      (opened)="opens = opens + 1"
    />
  `,
})
class CardHost {
  readonly labels = LABELS;
  readonly favorite = signal<boolean | null>(false);
  toggles = 0;
  opens = 0;
}

describe('LineCardComponent', () => {
  it('renders the code placard, name, chips and meta line', async () => {
    const fixture = TestBed.createComponent(CardHost);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(squash(el.querySelector('.plate')?.textContent)).toBe('ORN-1');
    expect(el.querySelector('.plate')?.getAttribute('aria-hidden')).toBe('true');
    expect(squash(el.querySelector('.name')?.textContent)).toBe('ORN-1 [ÖRNEK] Hat ORN-1');
    expect(el.querySelector('iv-mode-chip')).not.toBeNull();
    expect(squash(el.querySelector('iv-fare-chip')?.textContent).replace(/\s/g, '')).toBe(
      'Ücret:₺25,00',
    );
    const parts = Array.from(el.querySelectorAll('.meta-part')).map((p) => squash(p.textContent));
    expect(parts).toEqual(['5 durak', '06:00-23:00']);
  });

  it('emits open and favourite events and reflects the favourite state', async () => {
    const fixture = TestBed.createComponent(CardHost);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const star = () => el.querySelector<HTMLButtonElement>('.star');
    expect(star()?.getAttribute('aria-pressed')).toBe('false');
    expect(star()?.getAttribute('aria-label')).toBe('Favorilere ekle');

    star()?.click();
    el.querySelector<HTMLButtonElement>('.main')?.click();
    expect(fixture.componentInstance.toggles).toBe(1);
    expect(fixture.componentInstance.opens).toBe(1);

    fixture.componentInstance.favorite.set(true);
    await fixture.whenStable();
    expect(star()?.getAttribute('aria-pressed')).toBe('true');
    expect(star()?.getAttribute('aria-label')).toBe('Favorilerden çıkar');

    fixture.componentInstance.favorite.set(null);
    await fixture.whenStable();
    expect(star()).toBeNull();
  });
});

@Component({
  imports: [StateComponent],
  template: `
    <iv-state
      [kind]="kind()"
      heading="Henüz favori hat yok"
      [message]="message()"
      [actionLabel]="action()"
      (action)="actions = actions + 1"
    />
  `,
})
class StateHost {
  readonly kind = signal<StateKind>('empty');
  readonly message = signal('Bir hat kartındaki yıldıza dokun.');
  readonly action = signal('Hat ara');
  actions = 0;
}

describe('StateComponent', () => {
  it('renders heading, message and action, and announces politely when empty', async () => {
    const fixture = TestBed.createComponent(StateHost);
    await fixture.whenStable();
    const host = (fixture.nativeElement as HTMLElement).querySelector('iv-state');
    expect(host?.getAttribute('role')).toBe('status');
    expect(host?.classList.contains('iv-state--empty')).toBe(true);
    expect(squash(host?.querySelector('h2')?.textContent)).toBe('Henüz favori hat yok');
    expect(squash(host?.querySelector('p')?.textContent)).toBe('Bir hat kartındaki yıldıza dokun.');
    host?.querySelector<HTMLButtonElement>('button')?.click();
    expect(fixture.componentInstance.actions).toBe(1);
  });

  it('switches to an alert for errors and hides optional parts', async () => {
    const fixture = TestBed.createComponent(StateHost);
    fixture.componentInstance.kind.set('error');
    fixture.componentInstance.message.set('');
    fixture.componentInstance.action.set('');
    await fixture.whenStable();
    const host = (fixture.nativeElement as HTMLElement).querySelector('iv-state');
    expect(host?.getAttribute('role')).toBe('alert');
    expect(host?.classList.contains('iv-state--error')).toBe(true);
    expect(host?.querySelector('p')).toBeNull();
    expect(host?.querySelector('button')).toBeNull();
    expect(host?.querySelector('svg g')?.getAttribute('transform')).toContain('rotate');
  });

  it('marks the offline variant', async () => {
    const fixture = TestBed.createComponent(StateHost);
    fixture.componentInstance.kind.set('offline');
    await fixture.whenStable();
    const host = (fixture.nativeElement as HTMLElement).querySelector('iv-state');
    expect(host?.classList.contains('iv-state--offline')).toBe(true);
    expect(host?.getAttribute('role')).toBe('status');
  });
});
