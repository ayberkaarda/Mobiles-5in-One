import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LineCardComponent } from './line-card.component';
import { projectSketch, RouteSketchComponent } from './route-sketch.component';
import { StopSequenceComponent, StopSequenceItem } from './stop-sequence.component';

const LINE = [
  [34.01, 42.51],
  [34.05, 42.51],
  [34.05, 42.55],
];

@Component({
  imports: [RouteSketchComponent, StopSequenceComponent, LineCardComponent],
  template: `
    <iv-route-sketch [line]="line()" [stops]="line()" label="Hat ORN-1 güzergâhı" />
    <iv-stop-sequence [stops]="stops()" (selected)="picked.set($event)" />
    <iv-line-card
      code="ORN-1"
      name="Hat"
      mode="dolmus"
      [fareMinor]="undefined"
      [labels]="{
        mode: 'Dolmuş',
        fare: 'Ücret',
        fareFree: 'Ücretsiz',
        fareUnknown: 'Ücret bilinmiyor',
        favoriteAdd: '+',
        favoriteRemove: '-',
      }"
    />
  `,
})
class Host {
  readonly line = signal<number[][]>(LINE);
  readonly picked = signal<string | null>(null);
  readonly stops = signal<StopSequenceItem[]>([
    { slug: 'a', name: '<b>Durak A</b>' },
    { slug: 'b', name: 'Durak B', note: 'İşaretsiz durak' },
    { slug: 'c', name: 'Durak C' },
  ]);
}

describe('projectSketch', () => {
  it('fits the route into the box and keeps the aspect', () => {
    const { path, points } = projectSketch(LINE, LINE);
    expect(path.startsWith('M')).toBe(true);
    expect(path.split('L')).toHaveLength(3);
    for (const p of points) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(320);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(180);
    }
    // North is up: the last point (further north) is drawn higher.
    expect(points[2]?.y ?? Infinity).toBeLessThan(points[1]?.y ?? -Infinity);
  });

  it('handles a single stop and broken input', () => {
    expect(projectSketch([], [[34, 42]]).points).toEqual([{ x: 160, y: 90 }]);
    expect(projectSketch([], [])).toEqual({ path: '', points: [] });
    expect(projectSketch([[NaN, 1]], []).path).toBe('');
  });
});

describe('RouteSketchComponent, StopSequenceComponent and the fare-less line card', () => {
  it('draws the route, lists stops as text and emits the chosen stop', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('iv-route-sketch svg')?.getAttribute('aria-label')).toBe(
      'Hat ORN-1 güzergâhı',
    );
    expect(el.querySelectorAll('iv-route-sketch circle.stop')).toHaveLength(3);

    const names = Array.from(el.querySelectorAll('iv-stop-sequence .name'));
    expect(names[0]?.textContent).toBe('<b>Durak A</b>');
    expect(el.querySelector('iv-stop-sequence b')).toBeNull();
    expect(el.querySelectorAll('iv-stop-sequence li.terminal')).toHaveLength(2);
    expect(el.querySelector('iv-stop-sequence .note')?.textContent).toBe('İşaretsiz durak');
    el.querySelectorAll<HTMLButtonElement>('iv-stop-sequence button')[1]?.click();
    expect(fixture.componentInstance.picked()).toBe('b');

    expect(el.querySelector('iv-line-card iv-fare-chip')).toBeNull();
  });
});
