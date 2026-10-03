import { cx } from './class-names';
import styles from './primitives.module.css';

/**
 * PitchDiagram({ title, markers?, className? }): a 7v7 halı saha pitch as a working diagram
 * (direction §2.2, §4.7, §4.11): night turf with chalk lines and player markers drawn from data.
 * The pitch roles are fixed, so the diagram looks the same in both schemes. Server-rendered inline
 * SVG with presentation attributes only (no inline style), view box 520 × 336, landscape.
 *
 * - `title`: accessible description of what the diagram shows (required; the SVG is `role="img"`).
 * - `markers`: players on the pitch. `x` and `y` are percentages of the playing field (0 = left
 *   touchline / top, 100 = right / bottom). `number` is the kit number on the disc. `empty: true`
 *   draws the eksik marker (dashed chalk ring, number as an outline); `label` adds a short caption
 *   under an empty marker (`EKSİK · KALECİ`).
 *
 * Geometry follows `diagram.pitch` of `packages/brand/theme/tokens.json`: 2 px lines, centre circle
 * r 40, marker r 18, dash `4 4`. Never use it as a background or watermark (direction §5.1).
 */
export interface PitchMarker {
  readonly x: number;
  readonly y: number;
  readonly number?: number | string | undefined;
  readonly empty?: boolean | undefined;
  readonly label?: string | undefined;
}

const WIDTH = 520;
const HEIGHT = 336;
/** Playing field inside the turf: 20 px run-off on every side. */
const FIELD = { x: 20, y: 20, width: 480, height: 296 } as const;
const MARKER_RADIUS = 18;

function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 50;
}

function position(marker: PitchMarker): { cx: number; cy: number } {
  return {
    cx: Math.round(FIELD.x + (clampPercent(marker.x) / 100) * FIELD.width),
    cy: Math.round(FIELD.y + (clampPercent(marker.y) / 100) * FIELD.height),
  };
}

export function PitchDiagram({
  title,
  markers = [],
  className,
}: {
  readonly title: string;
  readonly markers?: readonly PitchMarker[];
  readonly className?: string | undefined;
}) {
  const midX = FIELD.x + FIELD.width / 2;
  const midY = FIELD.y + FIELD.height / 2;
  return (
    <svg
      className={cx(styles.pitch, className)}
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      role="img"
      aria-label={title}
      focusable="false"
    >
      <rect className={styles.pitchTurf} x="0" y="0" width={WIDTH} height={HEIGHT} rx="4" />
      <g className={styles.pitchChalk} strokeWidth="2">
        <rect x={FIELD.x} y={FIELD.y} width={FIELD.width} height={FIELD.height} />
        <line x1={midX} y1={FIELD.y} x2={midX} y2={FIELD.y + FIELD.height} />
        <circle cx={midX} cy={midY} r="40" />
        <rect x={FIELD.x} y={midY - 90} width="60" height="180" />
        <rect x={FIELD.x} y={midY - 45} width="22" height="90" />
        <rect x={FIELD.x + FIELD.width - 60} y={midY - 90} width="60" height="180" />
        <rect x={FIELD.x + FIELD.width - 22} y={midY - 45} width="22" height="90" />
      </g>
      <circle className={styles.pitchSpot} cx={midX} cy={midY} r="3" />
      {markers.map((marker, index) => {
        const { cx: x, cy: y } = position(marker);
        const key = `${String(index)}-${String(marker.number ?? '')}`;
        if (marker.empty === true) {
          return (
            <g key={key}>
              <circle
                className={styles.markerEmpty}
                cx={x}
                cy={y}
                r={MARKER_RADIUS}
                strokeWidth="2"
                strokeDasharray="4 4"
              />
              {marker.number === undefined ? null : (
                <text className={styles.markerEmptyNumber} x={x} y={y + 6} textAnchor="middle">
                  {marker.number}
                </text>
              )}
              {marker.label === undefined ? null : (
                <text
                  className={styles.markerLabel}
                  x={x}
                  y={y + MARKER_RADIUS + 16}
                  textAnchor="middle"
                >
                  {marker.label}
                </text>
              )}
            </g>
          );
        }
        return (
          <g key={key}>
            <circle className={styles.marker} cx={x} cy={y} r={MARKER_RADIUS} />
            {marker.number === undefined ? null : (
              <text className={styles.markerNumber} x={x} y={y + 6} textAnchor="middle">
                {marker.number}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
