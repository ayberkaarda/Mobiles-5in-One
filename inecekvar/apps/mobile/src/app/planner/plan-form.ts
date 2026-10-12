import { distanceMeters, inBbox } from '../shared/format';
import { quantizeCoord } from '../shared/location';

/** How a place was chosen: a stop from the city data, a tap on the map or the device position. */
export type PlaceSource = 'stop' | 'map' | 'gps';

/** One end of a trip. `label` is shown as text only; stop names come from contributors. */
export interface Place {
  source: PlaceSource;
  label: string;
  lng: number;
  lat: number;
}

export type PlanEnd = 'from' | 'to';

export const MAX_TRANSFER_CHOICES = [0, 1, 2] as const;
export type MaxTransfers = (typeof MAX_TRANSFER_CHOICES)[number];

/**
 * Two ends closer than this are the same place for the planner: the API answers by cells of
 * about 100 m (ADR-0020), so a shorter trip would plan from one cell to itself.
 */
export const SAME_PLACE_M = 100;

export type PlanFormError =
  | 'no-city'
  | 'missing-from'
  | 'missing-to'
  | 'from-outside-city'
  | 'to-outside-city'
  | 'same-place'
  | 'bad-transfers';

export interface PlanFormInput {
  city: { slug: string; bbox: readonly number[] } | null;
  from: Place | null;
  to: Place | null;
  maxTransfers: number;
}

export interface PlanRequestBody {
  city: string;
  from: { lat: number; lng: number };
  to: { lat: number; lng: number };
  max_transfers: MaxTransfers;
}

export function isMaxTransfers(value: unknown): value is MaxTransfers {
  return (MAX_TRANSFER_CHOICES as readonly unknown[]).includes(value);
}

const finite = (place: Place) => Number.isFinite(place.lng) && Number.isFinite(place.lat);

/**
 * Checks the form before anything is sent. Coordinates must be finite and inside the selected
 * city's bbox (the API refuses others with `plan.outside_city`), the two ends must differ and
 * the transfer limit must be 0, 1 or 2. The first problem found is returned.
 */
export function validatePlanForm(input: PlanFormInput): PlanFormError | null {
  const { city, from, to, maxTransfers } = input;
  if (!city) return 'no-city';
  if (!from) return 'missing-from';
  if (!to) return 'missing-to';
  if (!finite(from) || !inBbox([from.lng, from.lat], city.bbox)) return 'from-outside-city';
  if (!finite(to) || !inBbox([to.lng, to.lat], city.bbox)) return 'to-outside-city';
  if (distanceMeters([from.lng, from.lat], [to.lng, to.lat]) < SAME_PLACE_M) return 'same-place';
  if (!isMaxTransfers(maxTransfers)) return 'bad-transfers';
  return null;
}

/** The `POST plan` body for a valid form; `null` when `validatePlanForm` finds a problem. */
export function toPlanRequest(input: PlanFormInput): PlanRequestBody | null {
  if (validatePlanForm(input) !== null) return null;
  const { city, from, to } = input as Required<{
    [K in keyof PlanFormInput]: NonNullable<PlanFormInput[K]>;
  }>;
  return {
    city: city.slug,
    from: { lat: quantizeCoord(from.lat, 4), lng: quantizeCoord(from.lng, 4) },
    to: { lat: quantizeCoord(to.lat, 4), lng: quantizeCoord(to.lng, 4) },
    max_transfers: input.maxTransfers as MaxTransfers,
  };
}
