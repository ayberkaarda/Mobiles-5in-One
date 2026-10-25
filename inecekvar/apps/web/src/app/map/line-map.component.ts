import { NoticeComponent } from '@inecekvar/ui';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  OnDestroy,
  PLATFORM_ID,
  signal,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { LineOut } from '../content/public-types';
import { PUBLIC_WEB_CONFIG } from '../public-config';
import type { MapHandle } from './map-library';

@Component({
  selector: 'iv-line-map',
  standalone: true,
  imports: [NoticeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div class="iv-line-map">
      @if (!opened()) {
        <button type="button" (click)="open()">Haritayı etkileşimli aç</button>
      }
      @if (opened()) {
        <div
          #canvas
          class="iv-line-map-surface"
          role="region"
          [attr.aria-label]="'Etkileşimli harita: ' + line().name"
        ></div>
      }
      @if (failed()) {
        <iv-notice tone="error" message="Harita açılamadı." />
      }
      @if (attribution()) {
        <p>© OpenStreetMap katkıcıları</p>
      }
    </div>
  `,
  styles: `
    .iv-line-map button {
      width: 100%;
      min-height: 48px;
      font: inherit;
      font-weight: 650;
      color: var(--iv-board-sign);
      background: var(--iv-board);
      border: 0;
      border-radius: 0.875rem;
      box-shadow: inset 0 -3px 0 var(--iv-stripe);
      padding: 0.75rem 1rem;
      cursor: pointer;
    }
    .iv-line-map p {
      margin: 0.5rem 0 0;
      font-size: 0.85rem;
      color: var(--iv-ink-muted);
    }
    .iv-line-map button:focus-visible {
      outline: 2px solid currentColor;
      outline-offset: 4px;
    }
    .iv-line-map-surface {
      height: 20rem;
      border-radius: 0.9rem;
      position: relative;
      overflow: hidden;
    }
    .iv-line-map .maplibregl-canvas-container {
      position: absolute;
      inset: 0;
    }
    .iv-line-map .maplibregl-canvas {
      position: absolute;
      left: 0;
      top: 0;
    }
    .iv-line-map .maplibregl-canvas:focus-visible {
      outline: 2px solid var(--iv-info);
      outline-offset: -2px;
    }
  `,
})
export class LineMapComponent implements OnDestroy {
  readonly line = input.required<LineOut>();
  readonly city = input.required<string>();
  protected readonly opened = signal(false);
  protected readonly failed = signal(false);
  protected readonly attribution = signal(false);
  private readonly canvas = viewChild<ElementRef<HTMLDivElement>>('canvas');
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);
  private readonly config = inject(PUBLIC_WEB_CONFIG);
  private map: MapHandle | null = null;
  private revision = 0;
  private destroyed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      this.line();
      this.city();
      this.release();
      this.opened.set(false);
      this.failed.set(false);
      this.attribution.set(false);
    });
  }

  protected async open(): Promise<void> {
    if (!this.browser || this.opened()) return;
    const revision = ++this.revision;
    const current = () => !this.destroyed && revision === this.revision;
    this.opened.set(true);
    this.failed.set(false);
    this.timer = setTimeout(() => {
      if (current()) this.fail();
    }, 15000);
    try {
      await new Promise<void>((resolve) =>
        afterNextRender(() => resolve(), { injector: this.injector }),
      );
      if (!current()) return;
      const { loadMapLibrary, withTimeout, basemapUrlFor } = await import('./map-library');
      const [library, style] = await withTimeout(
        Promise.all([loadMapLibrary(this.document.baseURI), import('./map-style')]),
        10000,
      );
      if (!current()) return;
      const url = this.config.tilesOrigin
        ? basemapUrlFor(this.config.tilesOrigin, this.city())
        : null;
      const basemap = url && (await library.probeBasemap(url, 3000)) ? url : null;
      if (!current()) return;
      const container = this.canvas()?.nativeElement;
      if (!container) throw new Error('Missing map surface');
      const line = this.line();
      const stops = line.stops.map((stop) => stop.location);
      const css = this.document.defaultView?.getComputedStyle(container);
      const token = (name: string, fallback: string) =>
        css?.getPropertyValue(name).trim() || fallback;
      const colors = {
        background: token('--iv-bg', '#DADBD6'),
        surface: token('--iv-surface', '#FFFFFF'),
        sunk: token('--iv-surface-sunk', '#ECECEA'),
        ink: token('--iv-rail-casing', '#1F2124'),
        rail: token('--iv-rail', '#B3261E'),
        water: token('--iv-info', '#34557A'),
        stop: token('--iv-stop-fill', '#FFFFFF'),
      };
      const map = library.createMap({
        container,
        style: style.buildMapStyle(line.geometry.coordinates, stops, basemap, colors),
      });
      this.map = map;
      const bounds = style.boundsOf([...line.geometry.coordinates, ...stops]);
      if (bounds) map.fitBounds(bounds, { padding: 36, maxZoom: 16 });
      let hasBasemap = basemap !== null;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => {
        if (current()) this.fail();
      }, 10000);
      map.on('load', () => {
        if (!current()) return;
        clearTimeout(this.timer);
        this.attribution.set(hasBasemap);
      });
      map.on('error', (event) => {
        if (!current()) return;
        if (event.sourceId === 'basemap') {
          hasBasemap = false;
          this.attribution.set(false);
          map.setStyle(style.buildMapStyle(line.geometry.coordinates, stops, null, colors));
        } else {
          this.fail();
        }
      });
    } catch {
      if (current()) this.fail();
    }
  }
  private fail(): void {
    this.release();
    this.opened.set(false);
    this.failed.set(true);
    this.attribution.set(false);
  }
  private release(): void {
    this.revision++;
    clearTimeout(this.timer);
    this.map?.remove();
    this.map = null;
  }
  ngOnDestroy(): void {
    this.destroyed = true;
    this.release();
  }
}
