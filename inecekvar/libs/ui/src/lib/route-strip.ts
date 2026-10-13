import { svgNumber, svgPathD, svgViewBox, type SvgPoint } from './safe-svg';

/**
 * Schematic strip of a line or an itinerary (ADR-0059): stops as dots on one straight rail with
 * their names slanted above, ticks below, rides drawn as the turquoise rail with a lacivert
 * casing and walks as a dotted line. It is a diagram, not a map: positions say nothing about
 * distance. Every coordinate and path here is produced from numbers through the safe SVG helpers;
 * names are only ever passed on as text.
 */
export type StripNodeKind = 'terminal' | 'stop' | 'transfer' | 'place';

export interface StripNode {
  name: string;
  kind?: StripNodeKind;
  /** Short text under the dot, such as the stop number. */
  tick?: string;
}

export interface StripSegment {
  kind: 'ride' | 'walk';
  /** Line code shown on a placard under a ride. */
  code?: string;
  /** Short text under the segment, such as "3 durak" or "120 m". */
  label?: string;
}

export interface StripOptions {
  /** Width the strip aims to fit; longer strips grow and scroll. */
  fit?: number;
  /** Smallest distance between two stops. */
  minPitch?: number;
  /** Longest stop name drawn in full; longer names end in an ellipsis. */
  maxLabel?: number;
}

export interface StripNodeView {
  x: number;
  y: number;
  r: number;
  kind: StripNodeKind;
  label: string;
  labelX: number;
  labelY: number;
  labelTransform: string;
  tick: string;
  tickY: number;
}

export interface StripPlacard {
  x: number;
  y: number;
  width: number;
  height: number;
  code: string;
  textX: number;
  textY: number;
}

export interface StripLabel {
  x: number;
  y: number;
  text: string;
}

export interface StripLayout {
  width: number;
  height: number;
  viewBox: string;
  railY: number;
  nodes: StripNodeView[];
  /** One path per run of consecutive rides. */
  rides: string[];
  /** One path per walk. */
  walks: string[];
  placards: StripPlacard[];
  labels: StripLabel[];
}

/** Average advance of the 12 px label face, measured on DM Sans 700 at 12 px. */
const CHAR = 6.7;
const SLANT = 38;
const SIN = Math.sin((SLANT * Math.PI) / 180);
const COS = Math.cos((SLANT * Math.PI) / 180);
const PAD_LEFT = 20;
const PAD_TOP = 12;

/** A name cut to `max` characters (whole code points) with an ellipsis. */
export function stripLabel(name: string, max: number): string {
  const chars = Array.from(name.replace(/\s+/g, ' ').trim());
  return chars.length <= max ? chars.join('') : chars.slice(0, max - 1).join('') + '…';
}

const round = (value: number) => Number(svgNumber(value));

export function stripLayout(
  nodes: readonly StripNode[],
  segments: readonly StripSegment[] = [],
  options: StripOptions = {},
): StripLayout | null {
  const count = nodes.length;
  if (count < 2) return null;
  const fit = options.fit ?? 340;
  const minPitch = options.minPitch ?? 46;
  const maxLabel = Math.max(4, Math.min(40, Math.floor(options.maxLabel ?? 22)));
  if (!Number.isFinite(fit) || fit <= 0 || !Number.isFinite(minPitch) || minPitch <= 0) {
    return null;
  }
  const kinds = nodes.map((node, index): StripNodeKind => {
    if (node.kind) return node.kind;
    return index === 0 || index === count - 1 ? 'terminal' : 'stop';
  });
  const labels = nodes.map((node) => stripLabel(node.name, maxLabel));
  const longest = Math.max(...labels.map((label) => Array.from(label).length)) * CHAR;
  const lastReach = Array.from(labels[count - 1] ?? '').length * CHAR * COS + 14;
  const pitch = Math.max(minPitch, (fit - PAD_LEFT - lastReach) / (count - 1));
  const railY = round(PAD_TOP + longest * SIN + 26);
  const hasTicks = nodes.some((node) => !!node.tick);
  const rideSegments = segments.slice(0, count - 1);
  const hasPlacards = rideSegments.some((segment) => segment.kind === 'ride' && !!segment.code);
  const hasSegmentLabels = rideSegments.some((segment) => !!segment.label);
  const tickY = railY + 26;
  const placardY = railY + (hasTicks ? 36 : 20);
  const labelY = placardY + (hasPlacards ? 40 : 14);
  const height = round(
    hasSegmentLabels
      ? labelY + 10
      : hasPlacards
        ? placardY + 32
        : hasTicks
          ? tickY + 10
          : railY + 18,
  );
  const width = round(PAD_LEFT + pitch * (count - 1) + Math.max(PAD_LEFT, lastReach));
  const xs = nodes.map((_, index) => round(PAD_LEFT + pitch * index));

  const views: StripNodeView[] = nodes.map((node, index) => {
    const x = xs[index] ?? 0;
    const kind = kinds[index] ?? 'stop';
    const r = kind === 'terminal' ? 9 : kind === 'transfer' ? 8 : 6;
    const labelX = round(x + 4);
    const labelY = round(railY - r - 9);
    return {
      x,
      y: railY,
      r,
      kind,
      label: labels[index] ?? '',
      labelX,
      labelY,
      labelTransform: `rotate(-${SLANT} ${svgNumber(labelX)} ${svgNumber(labelY)})`,
      tick: node.tick ?? '',
      tickY: round(tickY),
    };
  });

  const rides: string[] = [];
  const walks: string[] = [];
  const placards: StripPlacard[] = [];
  const segmentLabels: StripLabel[] = [];
  let run: SvgPoint[] = [];
  for (let index = 0; index < count - 1; index++) {
    const segment: StripSegment = segments[index] ?? { kind: 'ride' };
    const from: SvgPoint = { x: xs[index] ?? 0, y: railY };
    const to: SvgPoint = { x: xs[index + 1] ?? 0, y: railY };
    if (segment.kind === 'walk') {
      if (run.length > 1) rides.push(svgPathD(run));
      run = [];
      walks.push(svgPathD([from, to]));
    } else {
      if (run.length === 0) run.push(from);
      run.push(to);
    }
    const middle = round((from.x + to.x) / 2);
    if (segment.kind === 'ride' && segment.code) {
      const code = stripLabel(segment.code, 10);
      const placardWidth = round(Array.from(code).length * 8.6 + 18);
      placards.push({
        x: round(middle - placardWidth / 2),
        y: round(placardY),
        width: placardWidth,
        height: 24,
        code,
        textX: middle,
        textY: round(placardY + 16.5),
      });
    }
    if (segment.label) {
      segmentLabels.push({ x: middle, y: round(labelY), text: stripLabel(segment.label, 14) });
    }
  }
  if (run.length > 1) rides.push(svgPathD(run));

  return {
    width,
    height,
    viewBox: svgViewBox(width, height),
    railY,
    nodes: views,
    rides,
    walks,
    placards,
    labels: segmentLabels,
  };
}
