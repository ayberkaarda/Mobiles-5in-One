import { EditProposal, LineDetail, StopDetail } from '@inecekvar/data-access';
import { TranslationKey } from '../i18n/translation';
import { LngLat } from '../contribute/simplify';
import { inBbox } from '../shared/format';

/**
 * Proposal forms (user story 5): pure validation and request builders mirroring the bounds of
 * `docs/api/openapi.json` (`NewLine`, `UpdateLine`, `NewStop`, `UpdateStop`, `FareUpdate`,
 * `Retire`). The API re-validates everything; these give early, specific messages.
 */
export type ProposalKind =
  'new_line' | 'update_line' | 'new_stop' | 'update_stop' | 'fare_update' | 'retire';

export const PROPOSAL_KINDS: readonly ProposalKind[] = [
  'new_line',
  'update_line',
  'fare_update',
  'retire',
  'new_stop',
  'update_stop',
];

export const KIND_LABELS: Record<ProposalKind, TranslationKey> = {
  new_line: 'proposal.kind.new_line',
  update_line: 'proposal.kind.update_line',
  new_stop: 'proposal.kind.new_stop',
  update_stop: 'proposal.kind.update_stop',
  fare_update: 'proposal.kind.fare_update',
  retire: 'proposal.kind.retire',
};

export function isProposalKind(value: unknown): value is ProposalKind {
  return typeof value === 'string' && (PROPOSAL_KINDS as readonly string[]).includes(value);
}

/** Kinds that are about an existing line. */
export const LINE_KINDS: readonly ProposalKind[] = ['update_line', 'fare_update', 'retire'];

export const LINE_MODES = ['dolmus', 'minibus', 'servis'] as const;
export type Mode = (typeof LINE_MODES)[number];
export const PAYMENTS = ['nakit', 'kart', 'istanbulkart'] as const;
export type PaymentMethod = (typeof PAYMENTS)[number];
export type StopKindValue = 'formal' | 'informal';

export const BOUNDS = {
  code: 32,
  name: 160,
  hours: 500,
  hail: 1000,
  reason: 500,
  minStops: 2,
  maxStops: 200,
  /** `Fare`: 0 to 10 000 000 minor units, i.e. up to ₺100 000,00. */
  fareMaxMinor: 10_000_000,
} as const;

export interface ProposalFields {
  code: string;
  name: string;
  mode: Mode | '';
  fare: string;
  hours: string;
  hail: string;
  payments: readonly PaymentMethod[];
  reason: string;
  stopName: string;
  stopKind: StopKindValue;
  location: LngLat | null;
  stopIds: readonly string[];
  traceId: string | null;
  photoId: string | null;
}

export function emptyFields(): ProposalFields {
  return {
    code: '',
    name: '',
    mode: '',
    fare: '',
    hours: '',
    hail: '',
    payments: [],
    reason: '',
    stopName: '',
    stopKind: 'informal',
    location: null,
    stopIds: [],
    traceId: null,
    photoId: null,
  };
}

/** The editable values of a published line, as the update form starts from them. */
export function fieldsFromLine(line: LineDetail): ProposalFields {
  return {
    ...emptyFields(),
    name: line.name,
    mode: isMode(line.mode) ? line.mode : '',
    fare: line.fare_minor === null ? '' : formatFareInput(line.fare_minor),
    hours: line.hours_text ?? '',
    hail: line.hail_notes ?? '',
    payments: line.payment_methods.filter(isPayment),
  };
}

export function fieldsFromStop(stop: StopDetail): ProposalFields {
  const [lng, lat] = stop.location;
  return {
    ...emptyFields(),
    stopName: stop.name,
    stopKind: stop.kind === 'formal' ? 'formal' : 'informal',
    location: typeof lng === 'number' && typeof lat === 'number' ? [lng, lat] : null,
  };
}

function isMode(value: string): value is Mode {
  return (LINE_MODES as readonly string[]).includes(value);
}

function isPayment(value: string): value is PaymentMethod {
  return (PAYMENTS as readonly string[]).includes(value);
}

/** `2550` → `25,50` for the input field. */
export function formatFareInput(minor: number): string {
  const lira = Math.floor(minor / 100);
  const kurus = minor % 100;
  return kurus === 0 ? String(lira) : `${lira},${String(kurus).padStart(2, '0')}`;
}

/**
 * Reads a fare typed in lira: `25`, `25,5`, `25,50`, `25.50`, `₺1.250,00`. Returns minor units,
 * `null` when empty, or `'invalid'`.
 */
export function parseFare(text: string): number | null | 'invalid' {
  let value = text.replace(/[\s₺]/g, '').replace(/TL$/i, '');
  if (value === '') return null;
  if (value.includes('.') && value.includes(',')) value = value.replace(/\./g, '');
  value = value.replace(',', '.');
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return 'invalid';
  const minor = Math.round(Number(value) * 100);
  return minor <= BOUNDS.fareMaxMinor ? minor : 'invalid';
}

export type FieldErrors = Partial<Record<keyof ProposalFields | 'form', TranslationKey>>;

export type Built = { ok: true; proposal: EditProposal } | { ok: false; errors: FieldErrors };

const tooLong = (value: string, max: number) => [...value].length > max;

function checkText(
  errors: FieldErrors,
  field: 'hours' | 'hail',
  value: string,
  max: number,
): string | null {
  const trimmed = value.trim();
  if (tooLong(trimmed, max)) errors[field] = 'proposal.errors.tooLong';
  return trimmed === '' ? null : trimmed;
}

function checkName(errors: FieldErrors, field: 'name' | 'stopName', value: string): string {
  const trimmed = value.trim();
  if (trimmed === '') errors[field] = 'proposal.errors.required';
  else if (tooLong(trimmed, BOUNDS.name)) errors[field] = 'proposal.errors.tooLong';
  return trimmed;
}

function checkFare(errors: FieldErrors, text: string, required: boolean): number | null {
  const fare = parseFare(text);
  if (fare === 'invalid') {
    errors.fare = 'proposal.errors.fare';
    return null;
  }
  if (fare === null && required) errors.fare = 'proposal.errors.required';
  return fare;
}

function done(errors: FieldErrors, proposal: () => EditProposal): Built {
  return Object.keys(errors).length > 0
    ? { ok: false, errors }
    : { ok: true, proposal: proposal() };
}

export function buildNewLine(city: string, f: ProposalFields): Built {
  const errors: FieldErrors = {};
  const code = f.code.trim();
  if (code === '') errors.code = 'proposal.errors.required';
  else if (tooLong(code, BOUNDS.code)) errors.code = 'proposal.errors.tooLong';
  const name = checkName(errors, 'name', f.name);
  if (f.mode === '') errors.mode = 'proposal.errors.required';
  const fare = checkFare(errors, f.fare, false);
  const hours = checkText(errors, 'hours', f.hours, BOUNDS.hours);
  const hail = checkText(errors, 'hail', f.hail, BOUNDS.hail);
  const stopIds = [...new Set(f.stopIds)];
  if (stopIds.length < BOUNDS.minStops) errors.stopIds = 'proposal.errors.stopsMin';
  else if (stopIds.length > BOUNDS.maxStops) errors.stopIds = 'proposal.errors.stopsMax';
  return done(errors, () => ({
    kind: 'new_line',
    city,
    code,
    name,
    mode: f.mode as Mode,
    stop_ids: stopIds,
    fare_minor: fare,
    hours_text: hours,
    hail_notes: hail,
    payment_methods: [...f.payments],
    trace_id: f.traceId,
    geometry_source: f.traceId ? 'trace' : null,
    photo_id: f.photoId,
  }));
}

function samePayments(a: readonly string[], b: readonly string[]): boolean {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * A diff against the published version: only fields that differ are sent, on top of
 * `base_version_no`, so the moderator sees exactly what changed. An emptied text field means
 * "unchanged" (the contract has no way to clear a field through a proposal).
 */
export function buildUpdateLine(line: LineDetail, f: ProposalFields): Built {
  const errors: FieldErrors = {};
  const name = checkName(errors, 'name', f.name);
  const fare = checkFare(errors, f.fare, false);
  const hours = checkText(errors, 'hours', f.hours, BOUNDS.hours);
  const hail = checkText(errors, 'hail', f.hail, BOUNDS.hail);
  const changes: Record<string, unknown> = {};
  if (name !== '' && name !== line.name) changes['name'] = name;
  if (fare !== null && fare !== line.fare_minor) changes['fare_minor'] = fare;
  if (hours !== null && hours !== (line.hours_text ?? null)) changes['hours_text'] = hours;
  if (hail !== null && hail !== (line.hail_notes ?? null)) changes['hail_notes'] = hail;
  if (!samePayments(f.payments, line.payment_methods.filter(isPayment))) {
    changes['payment_methods'] = [...f.payments];
  }
  if (f.traceId) {
    changes['trace_id'] = f.traceId;
    changes['geometry_source'] = 'trace';
  }
  if (Object.keys(errors).length === 0 && Object.keys(changes).length === 0) {
    errors.form = 'proposal.errors.noChange';
  }
  return done(errors, () => ({
    kind: 'update_line',
    line: line.id,
    base_version_no: line.version_no,
    changes,
    photo_id: f.photoId,
  }));
}

export function buildFareUpdate(line: LineDetail, f: ProposalFields): Built {
  const errors: FieldErrors = {};
  const fare = checkFare(errors, f.fare, true);
  if (fare !== null && fare === line.fare_minor) errors.fare = 'proposal.errors.sameFare';
  return done(errors, () => ({
    kind: 'fare_update',
    line: line.id,
    base_version_no: line.version_no,
    fare_minor: fare as number,
    photo_id: f.photoId,
  }));
}

export function buildRetire(line: LineDetail, f: ProposalFields): Built {
  const errors: FieldErrors = {};
  const reason = f.reason.trim();
  if (reason === '') errors.reason = 'proposal.errors.required';
  else if (tooLong(reason, BOUNDS.reason)) errors.reason = 'proposal.errors.tooLong';
  return done(errors, () => ({ kind: 'retire', line: line.id, reason, photo_id: f.photoId }));
}

export function buildNewStop(
  city: string,
  bbox: readonly number[] | null,
  f: ProposalFields,
): Built {
  const errors: FieldErrors = {};
  const name = checkName(errors, 'stopName', f.stopName);
  const location = f.location;
  if (!location) errors.location = 'proposal.errors.location';
  else if (bbox && bbox.length === 4 && !inBbox(location, bbox)) {
    errors.location = 'proposal.errors.outsideCity';
  }
  return done(errors, () => ({
    kind: 'new_stop',
    city,
    name,
    location: [...(location as LngLat)],
    stop_kind: f.stopKind,
    photo_id: f.photoId,
  }));
}

export function buildUpdateStop(
  stop: StopDetail,
  bbox: readonly number[] | null,
  f: ProposalFields,
): Built {
  const errors: FieldErrors = {};
  const name = checkName(errors, 'stopName', f.stopName);
  const changes: Record<string, unknown> = {};
  if (name !== '' && name !== stop.name) changes['name'] = name;
  if (f.stopKind !== stop.kind) changes['kind'] = f.stopKind;
  const [lng, lat] = stop.location;
  if (f.location && (f.location[0] !== lng || f.location[1] !== lat)) {
    if (bbox && bbox.length === 4 && !inBbox(f.location, bbox)) {
      errors.location = 'proposal.errors.outsideCity';
    }
    changes['location'] = [...f.location];
  }
  if (Object.keys(errors).length === 0 && Object.keys(changes).length === 0) {
    errors.form = 'proposal.errors.noChange';
  }
  return done(errors, () => ({ kind: 'update_stop', stop: stop.id, changes, photo_id: f.photoId }));
}
