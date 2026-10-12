import { PlanResult } from '@inecekvar/data-access';
import { formatFareMinor } from '@inecekvar/domain';
import { ItineraryLegView, ItineraryStep, ItinerarySummary } from '@inecekvar/ui';
import { TranslationKey, TranslationParams } from '../i18n/translation';
import { Place } from './plan-form';

export type Itinerary = PlanResult['itineraries'][number];
export type ItineraryLeg = Itinerary['legs'][number];
export type RideLeg = Extract<ItineraryLeg, { kind: 'ride' }>;
export type WalkLeg = Extract<ItineraryLeg, { kind: 'walk' }>;

export type Translate = (key: TranslationKey, params?: TranslationParams) => string;

/**
 * Rough travel time. The API returns stops and metres but no times (there are no timetables),
 * so the estimate uses 80 m per minute on foot, 2 minutes per stop on board and 5 minutes of
 * waiting per boarding.
 */
export const WALK_M_PER_MIN = 80;
export const MIN_PER_STOP = 2;
export const WAIT_MIN_PER_BOARDING = 5;

export const isRide = (leg: ItineraryLeg): leg is RideLeg => leg.kind === 'ride';

/** Shorter walks are not worth a step: the trip end is at the stop (the API then sends 0 m). */
export const MIN_WALK_M = 5;

/** The legs a person acts on: every ride and every walk of at least `MIN_WALK_M`. */
export function visibleLegs(itinerary: Itinerary): ItineraryLeg[] {
  return itinerary.legs.filter((leg) => isRide(leg) || leg.metres >= MIN_WALK_M);
}

export function estimateMinutes(itinerary: Itinerary): number {
  const boardings = itinerary.legs.filter(isRide).length;
  const minutes =
    itinerary.walk_m / WALK_M_PER_MIN +
    itinerary.ride_stops * MIN_PER_STOP +
    boardings * WAIT_MIN_PER_BOARDING;
  return Math.max(1, Math.round(minutes));
}

/** Walking distance rounded to 10 m (never shown as 0). */
export function roundMetres(metres: number): number {
  return Math.max(10, Math.round(metres / 10) * 10);
}

export function fareText(itinerary: Itinerary, t: Translate): string {
  const minor = itinerary.estimated_fare_minor;
  if (minor === null || minor === undefined) return t('fare.unknown');
  return minor === 0 ? t('fare.free') : t('planner.fareEstimate', { fare: formatFareMinor(minor) });
}

export function transfersText(itinerary: Itinerary, t: Translate): string {
  return itinerary.transfers === 0
    ? t('planner.direct')
    : t('planner.transfers', { count: itinerary.transfers });
}

/** The card: a chain of line placards and walks, duration, fare and transfers. */
export function summarize(itinerary: Itinerary, index: number, t: Translate): ItinerarySummary {
  const legs: ItineraryLegView[] = visibleLegs(itinerary).map((leg) =>
    isRide(leg)
      ? { kind: 'ride', code: leg.line_code, name: leg.line_name }
      : { kind: 'walk', label: t('planner.walkShort', { metres: roundMetres(leg.metres) }) },
  );
  const duration = t('planner.duration', { minutes: estimateMinutes(itinerary) });
  const fare = fareText(itinerary, t);
  const transfers = transfersText(itinerary, t);
  return {
    title: t('planner.option', { index: index + 1 }),
    legs,
    duration,
    fare,
    transfers,
    walk:
      itinerary.walk_m < MIN_WALK_M
        ? t('planner.noWalk')
        : t('planner.walkTotal', { metres: roundMetres(itinerary.walk_m) }),
  };
}

/** The ordered steps of one itinerary; every name is passed on as text. */
export function steps(itinerary: Itinerary, t: Translate): ItineraryStep[] {
  return visibleLegs(itinerary).map((leg) => {
    if (isRide(leg)) {
      return {
        kind: 'ride',
        code: leg.line_code,
        title: t('planner.stepRide', { code: leg.line_code, name: leg.line_name }),
        detail: t('planner.stepRideDetail', {
          board: leg.board_stop.name,
          alight: leg.alight_stop.name,
          count: leg.stop_count,
        }),
      };
    }
    const metres = roundMetres(leg.metres);
    const title =
      leg.to_stop === null
        ? t('planner.stepWalkToDestination', { metres })
        : t('planner.stepWalkToStop', { metres, stop: leg.to_stop.name });
    const detail =
      leg.from_stop === null
        ? t('planner.fromOrigin')
        : t('planner.fromStop', { stop: leg.from_stop.name });
    return { kind: 'walk', title, detail };
  });
}

export type LngLatPair = [number, number];

export interface PathSegment {
  kind: 'ride' | 'walk';
  coordinates: LngLatPair[];
}

/** Ordered stop positions of a line, used to draw a ride along its stops instead of a chord. */
export type LineStopsLookup = (
  lineSlug: string,
) => readonly { slug: string; location: readonly number[] }[] | undefined;

const pair = (location: readonly number[]): LngLatPair => [location[0] ?? NaN, location[1] ?? NaN];

/**
 * Stops of a ride between boarding and alighting, in travel order. Dolmuş lines run both ways,
 * so the slice is reversed when the alighting stop comes first. `null` when either stop is not
 * on the line as known.
 */
export function rideStops(
  leg: RideLeg,
  lineStops: readonly { slug: string; location: readonly number[] }[] | undefined,
): LngLatPair[] | null {
  if (!lineStops) return null;
  const board = lineStops.findIndex((s) => s.slug === leg.board_stop.slug);
  const alight = lineStops.findIndex((s) => s.slug === leg.alight_stop.slug);
  if (board < 0 || alight < 0 || board === alight) return null;
  const slice =
    board < alight
      ? lineStops.slice(board, alight + 1)
      : lineStops.slice(alight, board + 1).reverse();
  return slice.map((s) => pair(s.location));
}

/**
 * Map segments of an itinerary: walks as straight dashed lines (from the origin, between stops,
 * to the destination), rides along the line's stops when known and as a chord otherwise.
 */
export function itineraryPath(
  itinerary: Itinerary,
  origin: Pick<Place, 'lng' | 'lat'>,
  destination: Pick<Place, 'lng' | 'lat'>,
  lookup: LineStopsLookup = () => undefined,
): PathSegment[] {
  return itinerary.legs.map((leg) => {
    if (isRide(leg)) {
      const along = rideStops(leg, lookup(leg.line_slug));
      return {
        kind: 'ride',
        coordinates: along ?? [pair(leg.board_stop.location), pair(leg.alight_stop.location)],
      };
    }
    const start = leg.from_stop
      ? pair(leg.from_stop.location)
      : ([origin.lng, origin.lat] as LngLatPair);
    const end = leg.to_stop
      ? pair(leg.to_stop.location)
      : ([destination.lng, destination.lat] as LngLatPair);
    return { kind: 'walk', coordinates: [start, end] };
  });
}
