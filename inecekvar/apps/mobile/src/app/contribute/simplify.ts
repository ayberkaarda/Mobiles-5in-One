/** A recorded position as `[lng, lat]`, the order the API and GeoJSON use. */
export type LngLat = [number, number];

/** The API accepts at most this many trace points (spec section 6.6, `TraceInput.points`). */
export const MAX_TRACE_POINTS = 5000;

const METRES_PER_DEGREE_LAT = 110_540;
const METRES_PER_DEGREE_LNG_AT_EQUATOR = 111_320;

/** Drops consecutive repeats (the same fix reported twice adds nothing to the line). */
export function dedupe(points: readonly LngLat[]): LngLat[] {
  const out: LngLat[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push([point[0], point[1]]);
  }
  return out;
}

/**
 * Douglas-Peucker on a local flat projection (metres), iterative so a long ride cannot
 * overflow the call stack. Distances are measured to the segment, not the infinite line, so
 * a ride that doubles back keeps its turning point. The first and last point always stay.
 */
export function douglasPeucker(points: readonly LngLat[], toleranceMetres: number): LngLat[] {
  if (points.length <= 2) return points.map((p) => [p[0], p[1]]);
  const lat0 = points.reduce((sum, p) => sum + p[1], 0) / points.length;
  const kx = METRES_PER_DEGREE_LNG_AT_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const xs = points.map((p) => p[0] * kx);
  const ys = points.map((p) => p[1] * METRES_PER_DEGREE_LAT);
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tolerance2 = toleranceMetres * toleranceMetres;
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let worst = -1;
    let worstIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const d = segmentDistance2(xs, ys, i, start, end);
      if (d > worst) {
        worst = d;
        worstIndex = i;
      }
    }
    if (worstIndex !== -1 && worst > tolerance2) {
      keep[worstIndex] = 1;
      stack.push([start, worstIndex], [worstIndex, end]);
    }
  }
  const out: LngLat[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as LngLat;
    if (keep[i]) out.push([p[0], p[1]]);
  }
  return out;
}

function segmentDistance2(
  xs: readonly number[],
  ys: readonly number[],
  i: number,
  a: number,
  b: number,
): number {
  const ax = xs[a] as number;
  const ay = ys[a] as number;
  const dx = (xs[b] as number) - ax;
  const dy = (ys[b] as number) - ay;
  const px = (xs[i] as number) - ax;
  const py = (ys[i] as number) - ay;
  const length2 = dx * dx + dy * dy;
  let t = length2 === 0 ? 0 : (px * dx + py * dy) / length2;
  t = Math.max(0, Math.min(1, t));
  const ex = px - t * dx;
  const ey = py - t * dy;
  return ex * ex + ey * ey;
}

/** Always applied: well inside GPS noise, it only drops points that add no shape. */
export const BASE_TOLERANCE_M = 1;

export interface Simplified {
  points: LngLat[];
  /** The tolerance used, in metres (the base tolerance unless the cap needed more). */
  toleranceMetres: number;
}

/**
 * Simplifies with the base tolerance, then widens it by half each round until at most `cap`
 * points remain, so a normal ride keeps its shape and only very long or very dense recordings
 * lose detail. Always returns the two end points.
 */
export function simplifyToCap(points: readonly LngLat[], cap = MAX_TRACE_POINTS): Simplified {
  const unique = dedupe(points);
  let tolerance = BASE_TOLERANCE_M;
  for (;;) {
    const result = douglasPeucker(unique, tolerance);
    if (result.length <= cap) return { points: result, toleranceMetres: tolerance };
    tolerance *= 1.5;
  }
}
