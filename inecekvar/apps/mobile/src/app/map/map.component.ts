import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
  ViewEncapsulation,
} from '@angular/core';
import { TILES_BASE_URL } from '@inecekvar/data-access';
import { RouteSketchComponent } from '@inecekvar/ui';
import { ThemeService } from '../core/theme.service';
import { TPipe } from '../i18n/i18n';
import { PackRegistry } from '../packs/pack-registry';
import { ConnectivityService } from '../shared/connectivity.service';
import { MAP_LIBRARY_LOADER, MapHandle, MapLibrary } from './map-library';
import {
  boundsOf,
  buildMapStyle,
  DARK_PALETTE,
  LIGHT_PALETTE,
  LngLat,
  MapMarker,
  MapSegment,
} from './map-style';

export type MapStatus = 'loading' | 'ready' | 'no-basemap' | 'failed';

/** How long the basemap header may take before the map draws on the plain background. */
export const BASEMAP_PROBE_MS = 4000;

/** `pmtiles://` URL of a city's basemap archive on the tiles CDN (ADR-0024). */
export function basemapUrlFor(tilesBase: string, city: string): string {
  return `pmtiles://${tilesBase.replace(/\/+$/, '')}/${encodeURIComponent(city)}.pmtiles`;
}

/**
 * Interactive route map. The basemap is the city pack's PMTiles archive when one is installed,
 * else the tiles host. MapLibre and PMTiles load on first use as their own chunk; until then,
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
      <iv-route-sketch
        class="iv-map-sketch"
        [line]="sketchLine()"
        [stops]="sketchStops()"
        [label]="label()"
      />
      <div
        #canvas
        class="iv-map-canvas"
        [class.iv-map-canvas--on]="status() === 'ready' || status() === 'no-basemap'"
        [class.iv-map-canvas--pick]="pickable()"
        [attr.tabindex]="pickable() ? 0 : null"
        role="group"
        [attr.aria-label]="label()"
        (keydown)="onMapKey($event)"
      ></div>
      @if (pickable()) {
        <span class="iv-map-crosshair" aria-hidden="true">+</span>
        <button
          type="button"
          class="iv-map-pick-centre"
          [disabled]="status() !== 'ready' && status() !== 'no-basemap'"
          (click)="pickCentre()"
        >
          {{ 'map.pickCentre' | t }}
        </button>
      }
      @if (status() === 'ready') {
        <span class="iv-map-attribution">{{ 'map.attribution' | t }}</span>
      }
    </div>
    <p class="iv-map-announcement" aria-live="polite" aria-atomic="true">
      @if (chosenPoint(); as point) {
        {{ 'map.pointChosen' | t: { lng: point[0], lat: point[1] } }}
      }
    </p>
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
    .iv-map-crosshair {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      color: var(--iv-ink);
      background: var(--iv-surface);
      font-size: 28px;
      line-height: 1;
    }
    .iv-map-announcement {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
    .iv-map-pick-centre {
      position: absolute;
      left: 12px;
      bottom: 12px;
      min-height: 44px;
      padding: 8px 12px;
      border: 1px solid var(--iv-line-strong);
      border-radius: var(--iv-radius-s);
      background: var(--iv-surface);
      color: var(--iv-ink);
      font: inherit;
      cursor: pointer;
    }
    .iv-map-pick-centre:focus-visible,
    .iv-map-canvas:focus-visible {
      outline: 2px solid var(--iv-ink);
      outline-offset: -3px;
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
    .iv-map-canvas--pick .maplibregl-canvas-container.maplibregl-interactive {
      cursor: crosshair;
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
  private readonly packs = inject(PackRegistry);
  private readonly connectivity = inject(ConnectivityService);
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');
  private map: MapHandle | null = null;
  private appliedStyleKey = '';
  private destroyed = false;
  private probeGeneration = 0;
  private readonly library = signal<MapLibrary | null>(null);
  protected readonly chosenPoint = signal<[number, number] | null>(null);

  /** Route as `[lng, lat]` points; empty for a single stop. */
  readonly line = input<readonly LngLat[]>([]);
  readonly stops = input<readonly LngLat[]>([]);
  /** City slug whose PMTiles basemap is drawn; `null` draws the plain background. */
  readonly city = input<string | null>(null);
  /** Accessible name, translated by the caller. */
  readonly label = input.required<string>();
  /** Planner legs drawn on top of the plain route. */
  readonly segments = input<readonly MapSegment[]>([]);
  /** Planner trip ends. */
  readonly markers = input<readonly MapMarker[]>([]);
  /** `[minLng, minLat, maxLng, maxLat]` shown when there is nothing to fit, such as a city. */
  readonly area = input<readonly number[] | null>(null);
  /** When true a tap on the map emits `picked` with its `[lng, lat]`. */
  readonly pickable = input(false);
  readonly picked = output<[number, number]>();

  /** Everything drawn, for the static sketch and for fitting the view. */
  protected readonly sketchLine = computed<readonly LngLat[]>(() => {
    const segments = this.segments();
    return segments.length > 0 ? segments.flatMap((s) => s.coordinates) : this.line();
  });
  protected readonly sketchStops = computed<readonly LngLat[]>(() => [
    ...this.stops(),
    ...this.markers().map((m) => m.at),
  ]);
  private appliedBoundsKey = '';

  readonly status = signal<MapStatus>('loading');
  private readonly basemapUrl = signal<string | null>(null);

  constructor() {
    afterNextRender(() => void this.start());
    effect(() => {
      const city = this.city();
      const library = this.library();
      const generation = ++this.probeGeneration;
      if (library) {
        untracked(() => {
          this.chosenPoint.set(null);
          this.basemapUrl.set(null);
          this.status.set('loading');
          void this.refreshBasemap(library, city, generation);
        });
      }
    });
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
    // A new itinerary (or a new area) moves the view; picking a point does not.
    effect(() => {
      const bounds = this.fitBounds();
      const key = JSON.stringify(bounds);
      if (!this.map || !bounds || key === this.appliedBoundsKey) return;
      this.appliedBoundsKey = key;
      untracked(() => this.map?.fitBounds(bounds, { padding: 36, maxZoom: 16 }));
    });
  }

  /** What the view frames: the planner legs, else the route and stops, else the area. */
  private readonly fitBounds = computed(() => {
    const segments = this.segments();
    const points =
      segments.length > 0
        ? [...segments.flatMap((s) => s.coordinates), ...this.markers().map((m) => m.at)]
        : [...this.line(), ...this.stops()];
    const bounds = boundsOf(points);
    if (bounds) return bounds;
    const [minLng, minLat, maxLng, maxLat] = this.area() ?? [];
    return minLng !== undefined &&
      minLat !== undefined &&
      maxLng !== undefined &&
      maxLat !== undefined
      ? ([
          [minLng, minLat],
          [maxLng, maxLat],
        ] as [[number, number], [number, number]])
      : null;
  });

  private styleKey(): string {
    return JSON.stringify([
      this.theme.dark(),
      this.basemapUrl(),
      this.line(),
      this.stops(),
      this.segments(),
      this.markers(),
    ]);
  }

  private style() {
    return buildMapStyle({
      palette: this.theme.dark() ? DARK_PALETTE : LIGHT_PALETTE,
      basemapUrl: this.basemapUrl(),
      line: this.line(),
      stops: this.stops(),
      segments: this.segments(),
      markers: this.markers(),
    });
  }

  private async start(): Promise<void> {
    try {
      const library = await this.loadLibrary(this.baseUri);
      await this.packs.ready();
      if (!this.destroyed) this.library.set(library);
    } catch {
      if (!this.destroyed) this.status.set('failed');
    }
  }

  protected pickCentre(): void {
    if (!this.map || !this.pickable()) return;
    const centre = this.map.getCenter();
    this.emitPoint([centre.lng, centre.lat]);
  }

  protected onMapKey(event: KeyboardEvent): void {
    if (event.target !== event.currentTarget || !this.pickable()) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.pickCentre();
    }
  }

  private emitPoint(point: [number, number]): void {
    this.chosenPoint.set(point);
    this.picked.emit(point);
  }

  private async refreshBasemap(
    library: MapLibrary,
    city: string | null,
    generation: number,
  ): Promise<void> {
    const current = () =>
      !this.destroyed && generation === this.probeGeneration && city === this.city();
    try {
      // An installed pack's basemap first (read from the device); otherwise the tiles host,
      // which is not tried without a connection so the offline map draws at once.
      const source = city ? this.packs.basemapSource(city) : null;
      const url = source
        ? `pmtiles://${source.getKey()}`
        : city && this.tilesBase && this.connectivity.online()
          ? basemapUrlFor(this.tilesBase, city)
          : null;
      const basemap =
        url !== null && (await library.probeBasemap(url, BASEMAP_PROBE_MS, source ?? undefined));
      if (!current()) return;
      this.basemapUrl.set(basemap ? url : null);
      if (this.map) {
        this.status.set(basemap ? 'ready' : 'no-basemap');
        return;
      }
      const bounds = untracked(() => this.fitBounds());
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
      this.appliedBoundsKey = JSON.stringify(bounds);
      map.on('click', (event) => {
        const at = event.lngLat;
        if (!this.destroyed && at && untracked(() => this.pickable())) {
          this.emitPoint([at.lng, at.lat]);
        }
      });
      map.on('load', () => {
        if (!this.destroyed) this.status.set(this.basemapUrl() ? 'ready' : 'no-basemap');
      });
      map.on('error', (event) => {
        if (event.sourceId === 'basemap' && !this.destroyed) this.status.set('no-basemap');
      });
    } catch {
      if (current()) this.status.set('failed');
    }
  }
}
