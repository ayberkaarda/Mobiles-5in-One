import { svgNumber, svgPathD, svgViewBox, type SvgPoint } from '@inecekvar/ui';
import { isLocation } from './public-types';

export interface LineSketch {
  width: number;
  height: number;
  viewBox: string;
  pathD: string;
  stops: { cx: number; cy: number }[];
}

export function projectLine(
  coordinates: number[][],
  stops: { location: number[] }[],
  options: { width?: number; height?: number; padding?: number } = {},
): LineSketch | null {
  const { width = 640, height = 360, padding = 24 } = options;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(padding) ||
    width < 1 ||
    height < 1 ||
    width >= 1e21 ||
    height >= 1e21 ||
    padding < 0 ||
    padding * 2 >= Math.min(width, height) ||
    coordinates.length < 2
  )
    return null;

  const locations: [number, number][] = [];
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const coordinate of coordinates) {
    if (!isLocation(coordinate)) return null;
    locations.push(coordinate);
    minLon = Math.min(minLon, coordinate[0]);
    maxLon = Math.max(maxLon, coordinate[0]);
    minLat = Math.min(minLat, coordinate[1]);
    maxLat = Math.max(maxLat, coordinate[1]);
  }
  const cosine = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLon - minLon) * cosine;
  const spanY = maxLat - minLat;
  if (spanX === 0 && spanY === 0) return null;
  const scale = Math.min(
    spanX > 0 ? (width - 2 * padding) / spanX : Infinity,
    spanY > 0 ? (height - 2 * padding) / spanY : Infinity,
  );
  if (!Number.isFinite(scale)) return null;
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const roundInside = (value: number, max: number) => {
    const bounded = Math.min(max, Math.max(0, value));
    return Math.min(Math.floor(max * 100) / 100, Number(svgNumber(bounded)));
  };
  const project = ([lon, lat]: [number, number]) => ({
    x: roundInside(offsetX + (lon - minLon) * cosine * scale, width),
    y: roundInside(offsetY + (maxLat - lat) * scale, height),
  });
  const pointCount = Math.min(400, locations.length);
  const points: SvgPoint[] = [];
  for (let i = 0; i < pointCount; i++) {
    const coordinate = locations[Math.floor((i * (locations.length - 1)) / (pointCount - 1))];
    if (coordinate) points.push(project(coordinate));
  }
  const projectedStops: { cx: number; cy: number }[] = [];
  for (const stop of stops) {
    if (!isLocation(stop?.location)) continue;
    const point = project(stop.location);
    projectedStops.push({ cx: point.x, cy: point.y });
  }
  return {
    width,
    height,
    viewBox: svgViewBox(width, height),
    pathD: svgPathD(points),
    stops: projectedStops,
  };
}
