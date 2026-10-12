import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** A `[lng, lat]` pair as the API sends it. */
export type LngLat = readonly number[];

const WIDTH = 320;
const HEIGHT = 180;
const PAD = 22;

export interface SketchGeometry {
  path: string;
  points: { x: number; y: number }[];
}

/**
 * Projects `[lng, lat]` coordinates into the sketch box (equirectangular, longitude scaled by
 * the cosine of the mean latitude, aspect kept, centred).
 */
export function projectSketch(line: readonly LngLat[], stops: readonly LngLat[]): SketchGeometry {
  const valid = (p: LngLat): p is [number, number] =>
    Number.isFinite(p[0]) && Number.isFinite(p[1]);
  const all = [...line, ...stops].filter(valid);
  if (all.length === 0) return { path: '', points: [] };
  const lats = all.map((p) => p[1]);
  const meanLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((meanLat * Math.PI) / 180);
  const xs = all.map((p) => p[0] * kx);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...lats);
  const maxY = Math.max(...lats);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const scale = Math.min(
    spanX > 0 ? (WIDTH - 2 * PAD) / spanX : Infinity,
    spanY > 0 ? (HEIGHT - 2 * PAD) / spanY : Infinity,
  );
  const s = Number.isFinite(scale) ? scale : 0;
  const offX = (WIDTH - spanX * s) / 2;
  const offY = (HEIGHT - spanY * s) / 2;
  const project = ([lng, lat]: [number, number]) => ({
    x: Math.round((offX + (lng * kx - minX) * s) * 10) / 10,
    y: Math.round((HEIGHT - offY - (lat - minY) * s) * 10) / 10,
  });
  const path = line
    .filter(valid)
    .map(project)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`)
    .join(' ');
  return { path, points: stops.filter(valid).map(project) };
}

/**
 * A static drawing of a route: the polyline on the minibüs stripe colour with its stops. It is
 * the placeholder while the interactive map loads and the fallback when WebGL is missing.
 */
@Component({
  selector: 'iv-route-sketch',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + width + ' ' + height"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      [attr.aria-label]="label()"
    >
      <rect class="ground" [attr.width]="width" [attr.height]="height" />
      <path class="grid" d="M0 45H320M0 90H320M0 135H320M80 0V180M160 0V180M240 0V180" />
      @if (geometry().path) {
        <path class="casing" [attr.d]="geometry().path" />
        <path class="route" [attr.d]="geometry().path" />
      }
      @for (point of geometry().points; track $index) {
        <circle class="stop" [attr.cx]="point.x" [attr.cy]="point.y" r="5" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      display: block;
      width: 100%;
      height: 100%;
    }
    .ground {
      fill: var(--iv-surface-sunk);
    }
    .grid {
      stroke: var(--iv-line);
      stroke-width: 1;
    }
    .casing {
      fill: none;
      stroke: var(--iv-color-lacivert);
      stroke-width: 8;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .route {
      fill: none;
      stroke: var(--iv-color-turkuaz);
      stroke-width: 5;
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    .stop {
      fill: var(--iv-color-krem);
      stroke: var(--iv-color-lacivert);
      stroke-width: 2.5;
    }
  `,
})
export class RouteSketchComponent {
  protected readonly width = WIDTH;
  protected readonly height = HEIGHT;

  /** Route coordinates as `[lng, lat]`; may be empty for a single stop. */
  readonly line = input<readonly LngLat[]>([]);
  readonly stops = input<readonly LngLat[]>([]);
  /** Accessible name of the drawing, translated by the caller. */
  readonly label = input.required<string>();

  protected readonly geometry = computed(() => projectSketch(this.line(), this.stops()));
}
