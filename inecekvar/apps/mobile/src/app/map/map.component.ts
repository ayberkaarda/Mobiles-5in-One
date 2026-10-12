import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { TILES_BASE_URL } from '@inecekvar/data-access';
import { RouteSketchComponent } from '@inecekvar/ui';
import { ThemeService } from '../core/theme.service';
import { TPipe } from '../i18n/i18n';
import { MAP_LIBRARY_LOADER, MapHandle } from './map-library';
import { boundsOf, buildMapStyle, DARK_PALETTE, LIGHT_PALETTE, LngLat } from './map-style';

export type MapStatus = 'loading' | 'ready' | 'no-basemap' | 'failed';

/** How long the basemap header may take before the map draws on the plain background. */
export const BASEMAP_PROBE_MS = 4000;

/** `pmtiles://` URL of a city's basemap archive on the tiles CDN (ADR-0024). */
export function basemapUrlFor(tilesBase: string, city: string): string {
  return `pmtiles://${tilesBase.replace(/\/+$/, '')}/${encodeURIComponent(city)}.pmtiles`;
}

/**
 * Interactive route map. MapLibre and PMTiles load on first use as their own chunk; until then,
 * and for good when the map cannot start (no WebGL), the static route sketch shows. When the
 * city basemap cannot be read the map still draws the route on a plain background. The style
 * follows light and dark mode; the map is removed on destroy.
 */
@Component({
  selector: 'iv-map',
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  imports: [RouteSketchComponent, TPipe],
  host: { '[attr.data-status]': 'status()' },
  template: `
    <div class="iv-map-frame">
      <iv-route-sketch class="iv-map-sketch" [line]="line()" [stops]="stops()" [label]="label()" />
      <div
        #canvas
        class="iv-map-canvas"
        [class.iv-map-canvas--on]="status() === 'ready' || status() === 'no-basemap'"
        aria-hidden="true"
      ></div>
      @if (status() === 'ready') {
        <span class="iv-map-attribution">{{ 'map.attribution' | t }}</span>
      }
    </div>
    @switch (status()) {
      @case ('loading') {
        <p class="iv-map-note" role="status">{{ 'map.loading' | t }}</p>
      }
      @case ('no-basemap') {
        <p class="iv-map-note">{{ 'map.basemapUnavailable' | t }}</p>
      }
      @case ('failed') {
        <p class="iv-map-note">{{ 'map.unavailable' | t }}</p>
      }
    }
  `,
  styles: `
    iv-map {
      display: block;
    }
    .iv-map-frame {
      position: relative;
      height: 220px;
      overflow: hidden;
      border: 1px solid var(--iv-line);
      border-radius: var(--iv-radius-m);
      background: var(--iv-surface-sunk);
    }
    .iv-map-sketch,
    .iv-map-canvas {
      position: absolute;
      inset: 0;
    }
    .iv-map-canvas {
      visibility: hidden;
    }
    .iv-map-canvas--on {
      visibility: visible;
    }
    .iv-map-canvas.maplibregl-map {
      position: absolute;
      overflow: hidden;
      -webkit-tap-highlight-color: transparent;
    }
    .iv-map-canvas .maplibregl-canvas {
      position: absolute;
      left: 0;
      top: 0;
    }
    .iv-map-canvas .maplibregl-canvas-container.maplibregl-interactive {
      cursor: grab;
      user-select: none;
    }
    .iv-map-canvas .maplibregl-touch-zoom-rotate,
    .iv-map-canvas .maplibregl-touch-zoom-rotate .maplibregl-canvas {
      touch-action: pan-x pan-y;
    }
    .iv-map-canvas .maplibregl-touch-drag-pan,
    .iv-map-canvas .maplibregl-touch-drag-pan .maplibregl-canvas {
      touch-action: pinch-zoom;
    }
    .iv-map-canvas .maplibregl-touch-zoom-rotate.maplibregl-touch-drag-pan,
    .iv-map-canvas .maplibregl-touch-zoom-rotate.maplibregl-touch-drag-pan .maplibregl-canvas {
      touch-action: none;
    }
    .iv-map-attribution {
      position: absolute;
      right: 6px;
      bottom: 6px;
      padding: 1px 6px;
      border-radius: 6px;
      background: var(--iv-surface);
      color: var(--iv-ink-muted);
      font-size: 11px;
    }
    .iv-map-note {
      margin: 8px 0 0;
      font-size: 13px;
      line-height: 1.45;
      color: var(--iv-ink-muted);
    }
  `,
})
export class MapComponent {
  private readonly loadLibrary = inject(MAP_LIBRARY_LOADER);
  private readonly tilesBase = inject(TILES_BASE_URL);
  private readonly baseUri = inject(DOCUMENT).baseURI;
  private readonly theme = inject(ThemeService);
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');
  private map: MapHandle | null = null;
  private appliedStyleKey = '';
  private destroyed = false;

  /** Route as `[lng, lat]` points; empty for a single stop. */
  readonly line = input<readonly LngLat[]>([]);
  readonly stops = input<readonly LngLat[]>([]);
  /** City slug whose PMTiles basemap is drawn; `null` draws the plain background. */
  readonly city = input<string | null>(null);
  /** Accessible name, translated by the caller. */
  readonly label = input.required<string>();

  readonly status = signal<MapStatus>('loading');
  private readonly basemapUrl = signal<string | null>(null);

  constructor() {
    afterNextRender(() => void this.start());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.map?.remove();
      this.map = null;
    });
    // Theme, data or basemap changes after the first draw swap the whole style.
    effect(() => {
      const key = this.styleKey();
      if (!this.map || key === this.appliedStyleKey) return;
      this.appliedStyleKey = key;
      const style = untracked(() => this.style());
      untracked(() => this.map?.setStyle(style));
    });
  }

  private styleKey(): string {
    return JSON.stringify([this.theme.dark(), this.basemapUrl(), this.line(), this.stops()]);
  }

  private style() {
    return buildMapStyle({
      palette: this.theme.dark() ? DARK_PALETTE : LIGHT_PALETTE,
      basemapUrl: this.basemapUrl(),
      line: this.line(),
      stops: this.stops(),
    });
  }

  private async start(): Promise<void> {
    try {
      const library = await this.loadLibrary(this.baseUri);
      const city = this.city();
      const url = city && this.tilesBase ? basemapUrlFor(this.tilesBase, city) : null;
      const basemap = url !== null && (await library.probeBasemap(url, BASEMAP_PROBE_MS));
      if (this.destroyed) return;
      this.basemapUrl.set(basemap ? url : null);
      const bounds = boundsOf([...this.line(), ...this.stops()]);
      // A single stop (or a route collapsed to one point) is centred instead of fitted.
      const [sw, ne] = bounds ?? [];
      const single = sw && ne && sw[0] === ne[0] && sw[1] === ne[1] ? sw : undefined;
      const map = library.createMap({
        container: this.canvas().nativeElement,
        style: untracked(() => this.style()),
        ...(single ? { center: single, zoom: 15 } : bounds ? { bounds } : {}),
      });
      this.map = map;
      this.appliedStyleKey = untracked(() => this.styleKey());
      map.on('load', () => {
        if (!this.destroyed) this.status.set(basemap ? 'ready' : 'no-basemap');
      });
      map.on('error', (event) => {
        if (event.sourceId === 'basemap' && !this.destroyed) this.status.set('no-basemap');
      });
    } catch {
      if (!this.destroyed) this.status.set('failed');
    }
  }
}
