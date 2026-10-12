import { svgPathD, svgViewBox, type SvgPoint } from '@inecekvar/ui';
import { formatFare } from '../../content/format';
import { isLocation, modeLabel, paymentLabel } from '../../content/public-types';
import type { QueueEdit } from '../admin-api';

export interface FieldChange {
  field: string;
  label: string;
  from: string;
  to: string;
}

export interface MapDiff {
  viewBox: string;
  /** Current geometry; null when the line has none yet (a new line). */
  before: string | null;
  /** Proposed geometry; null when the proposal keeps no line (a retirement keeps the old one). */
  after: string | null;
  changed: boolean;
}

const LABELS: Readonly<Record<string, string>> = {
  name: 'Ad',
  code: 'Hat kodu',
  mode: 'Tür',
  fare_minor: 'Ücret',
  hours_text: 'Saatler',
  hail_notes: 'Durdurma notları',
  payment_methods: 'Ödeme',
  stop_ids: 'Duraklar',
  geometry: 'Güzergâh',
  status: 'Durum',
  location: 'Konum',
  kind: 'Durak türü',
  stop_kind: 'Durak türü',
};

export const KIND_LABELS: Readonly<Record<string, string>> = {
  new_line: 'Yeni hat',
  update_line: 'Hat güncellemesi',
  fare_update: 'Ücret güncellemesi',
  new_stop: 'Yeni durak',
  update_stop: 'Durak güncellemesi',
  retire: 'Hattı kaldırma',
};

const MAX_TEXT = 600;

function clip(text: string): string {
  const chars = Array.from(text);
  return chars.length > MAX_TEXT ? chars.slice(0, MAX_TEXT).join('') + '…' : text;
}

function show(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  switch (field) {
    case 'fare_minor':
      return typeof value === 'number'
        ? value === 0
          ? 'Ücretsiz'
          : (formatFare(value) ?? '—')
        : '—';
    case 'payment_methods':
      return Array.isArray(value)
        ? value.map((item) => paymentLabel(String(item)) ?? String(item)).join(', ') || '—'
        : '—';
    case 'stop_ids':
      return Array.isArray(value) ? `${value.length} durak` : '—';
    case 'geometry':
      return Array.isArray(value) ? `${value.length} nokta` : '—';
    case 'status':
      return value === 'retired' ? 'Kaldırıldı' : value === 'published' ? 'Yayında' : String(value);
    case 'mode':
      return modeLabel(String(value));
    case 'location':
      return isLocation(value) ? `${value[1].toFixed(5)}, ${value[0].toFixed(5)}` : '—';
    default:
      return typeof value === 'string' ? clip(value) : clip(JSON.stringify(value) ?? '—');
  }
}

/** The server-computed diff (`{field: {from, to}}`) as rows of plain text. */
export function describeChanges(edit: Pick<QueueEdit, 'diff'>): FieldChange[] {
  const diff = edit.diff;
  if (diff === null || typeof diff !== 'object' || Array.isArray(diff)) return [];
  const rows: FieldChange[] = [];
  for (const [field, change] of Object.entries(diff)) {
    if (change === null || typeof change !== 'object' || Array.isArray(change)) continue;
    const { from, to } = change as { from?: unknown; to?: unknown };
    rows.push({
      field,
      label: LABELS[field] ?? field,
      from: show(field, from),
      to: show(field, to),
    });
  }
  return rows;
}

/** A photo id in the payload; the API offers no read link, so the UI says "no preview". */
export function hasPhoto(edit: Pick<QueueEdit, 'payload'>): boolean {
  const photo = (edit.payload as Record<string, unknown>)['photo_id'];
  return typeof photo === 'string' && photo !== '';
}

function coordinates(value: QueueEdit['current_geometry']): [number, number][] {
  if (!value || !Array.isArray(value.coordinates)) return [];
  return value.coordinates.filter((point): point is [number, number] => isLocation(point));
}

/**
 * Old and new geometry projected into one frame, as SVG path data from numbers only (the same
 * approach as the public line pages; no user text enters the drawing).
 */
export function projectMapDiff(
  edit: Pick<QueueEdit, 'current_geometry' | 'proposed_geometry'>,
  width = 480,
  height = 240,
  padding = 18,
): MapDiff | null {
  const before = coordinates(edit.current_geometry);
  const after = coordinates(edit.proposed_geometry);
  const all = [...before, ...after];
  if (all.length < 2) return null;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of all) {
    minLon = Math.min(minLon, lon);
    maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
  }
  const cosine = Math.cos((((minLat + maxLat) / 2) * Math.PI) / 180);
  const spanX = (maxLon - minLon) * cosine;
  const spanY = maxLat - minLat;
  if (spanX === 0 && spanY === 0) return null;
  const scale = Math.min(
    spanX > 0 ? (width - 2 * padding) / spanX : Infinity,
    spanY > 0 ? (height - 2 * padding) / spanY : Infinity,
  );
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const project = ([lon, lat]: [number, number]): SvgPoint => ({
    x: Math.round((offsetX + (lon - minLon) * cosine * scale) * 100) / 100,
    y: Math.round((offsetY + (maxLat - lat) * scale) * 100) / 100,
  });
  const path = (points: [number, number][]) =>
    points.length >= 2 ? svgPathD(sample(points).map(project)) : null;
  const same =
    before.length === after.length &&
    before.every(
      (point, index) => point[0] === after[index]?.[0] && point[1] === after[index]?.[1],
    );
  return {
    viewBox: svgViewBox(width, height),
    before: path(before),
    after: path(after),
    changed: !same,
  };
}

function sample(points: [number, number][], limit = 400): [number, number][] {
  if (points.length <= limit) return points;
  const result: [number, number][] = [];
  for (let i = 0; i < limit; i++) {
    result.push(points[Math.floor((i * (points.length - 1)) / (limit - 1))] as [number, number]);
  }
  return result;
}
