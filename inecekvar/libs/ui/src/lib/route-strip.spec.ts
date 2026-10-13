import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RouteStripComponent } from './route-strip.component';
import { StripNode, StripSegment, stripLabel, stripLayout } from './route-strip';

const NUMBERS_ONLY_PATH = /^M [-0-9. ]+( L [-0-9. ]+)*$/;
const stops = (count: number): StripNode[] =>
  Array.from({ length: count }, (_, index) => ({
    name: `Durak ${index + 1}`,
    tick: `${index + 1}`,
  }));

describe('stripLayout', () => {
  it('puts every stop on one rail, in order, with terminals at both ends', () => {
    const layout = stripLayout(stops(5));
    expect(layout).not.toBeNull();
    const nodes = layout?.nodes ?? [];
    expect(nodes.map((node) => node.kind)).toEqual([
      'terminal',
      'stop',
      'stop',
      'stop',
      'terminal',
    ]);
    expect(new Set(nodes.map((node) => node.y))).toEqual(new Set([layout?.railY]));
    for (let index = 1; index < nodes.length; index++) {
      expect(nodes[index]?.x ?? 0).toBeGreaterThan(nodes[index - 1]?.x ?? 0);
    }
    expect(layout?.rides).toHaveLength(1);
    expect(layout?.walks).toHaveLength(0);
  });

  it('builds paths, view box and label transforms from numbers only', () => {
    const segments: StripSegment[] = [
      { kind: 'walk', label: '120 m' },
      { kind: 'ride', code: 'ORN-1', label: '3 durak' },
      { kind: 'walk', label: '40 m' },
    ];
    const layout = stripLayout(
      [
        { name: 'Ev', kind: 'place' },
        { name: 'A' },
        { name: 'B', kind: 'transfer' },
        { name: 'İş', kind: 'place' },
      ],
      segments,
    );
    expect(layout?.viewBox).toMatch(/^0 0 [0-9.]+ [0-9.]+$/);
    for (const d of [...(layout?.rides ?? []), ...(layout?.walks ?? [])]) {
      expect(d).toMatch(NUMBERS_ONLY_PATH);
    }
    expect(layout?.walks).toHaveLength(2);
    expect(layout?.rides).toHaveLength(1);
    for (const node of layout?.nodes ?? []) {
      expect(node.labelTransform).toMatch(/^rotate\(-38 [0-9.]+ [0-9.]+\)$/);
    }
    expect(layout?.placards.map((placard) => placard.code)).toEqual(['ORN-1']);
    expect(layout?.labels.map((label) => label.text)).toEqual(['120 m', '3 durak', '40 m']);
  });

  it('keeps short strips inside the fit width and lets long ones grow', () => {
    expect(stripLayout(stops(5), [], { fit: 340 })?.width).toBeLessThanOrEqual(341);
    const long = stripLayout(stops(24), [], { fit: 340, minPitch: 46 });
    expect(long?.width).toBeGreaterThan(46 * 23);
  });

  it('refuses a strip of fewer than two stops and bad options', () => {
    expect(stripLayout(stops(1))).toBeNull();
    expect(stripLayout(stops(3), [], { fit: Number.NaN })).toBeNull();
    expect(stripLayout(stops(3), [], { minPitch: 0 })).toBeNull();
  });

  it('cuts long names by whole characters and collapses spaces', () => {
    expect(stripLabel('  Kadıköy   Rıhtım  ', 22)).toBe('Kadıköy Rıhtım');
    expect(stripLabel('Çok uzun bir durak adı burada sürüyor', 12)).toBe('Çok uzun bi…');
    expect(Array.from(stripLabel('🚌'.repeat(30), 10))).toHaveLength(10);
  });
});

@Component({
  imports: [RouteStripComponent],
  template: `<iv-route-strip [nodes]="nodes()" [segments]="segments()" label="ORN-1 hat şeması" />`,
})
class Host {
  readonly nodes = signal<StripNode[]>(stops(5));
  readonly segments = signal<StripSegment[]>([]);
}

describe('RouteStripComponent', () => {
  it('draws one circle per stop, a cased rail and the text alternative', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const svg = el.querySelector('svg.iv-strip');
    expect(svg?.getAttribute('role')).toBe('img');
    expect(svg?.getAttribute('aria-label')).toBe('ORN-1 hat şeması');
    expect(el.querySelectorAll('circle.node')).toHaveLength(5);
    expect(el.querySelectorAll('circle')).toHaveLength(5);
    expect(el.querySelector('path.casing')).not.toBeNull();
    for (const path of Array.from(el.querySelectorAll('path'))) {
      expect(path.getAttribute('d')).toMatch(NUMBERS_ONLY_PATH);
    }
    expect(el.querySelector('.scroller')?.getAttribute('tabindex')).toBeNull();
  });

  it('renders stored markup in stop names as text and scrolls long strips', async () => {
    const fixture = TestBed.createComponent(Host);
    const payload = '<img src=x onerror=alert(1)>';
    fixture.componentInstance.nodes.set([{ name: payload }, ...stops(9)]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('text.name')?.textContent?.trim()).toBe(stripLabel(payload, 22));
    expect(el.querySelector('.scroller')?.getAttribute('tabindex')).toBe('0');
  });

  it('marks walks dotted and rides with their placard', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.nodes.set([
      { name: 'Ev', kind: 'place' },
      { name: 'A' },
      { name: 'B' },
    ]);
    fixture.componentInstance.segments.set([
      { kind: 'walk', label: '120 m' },
      { kind: 'ride', code: 'ORN-2', label: '2 durak' },
    ]);
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelectorAll('path.walk')).toHaveLength(1);
    expect(el.querySelector('text.code')?.textContent?.trim()).toBe('ORN-2');
    expect(el.querySelector('rect.node.place')).not.toBeNull();
  });
});
