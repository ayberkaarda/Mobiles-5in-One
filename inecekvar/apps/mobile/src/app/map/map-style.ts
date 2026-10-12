import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';

/** A `[lng, lat]` pair as the API sends it. */
export type LngLat = readonly number[];

export interface MapPalette {
  background: string;
  earth: string;
  water: string;
  park: string;
  building: string;
  minorRoad: string;
  majorRoad: string;
  routeCasing: string;
  route: string;
  stopFill: string;
  stopStroke: string;
}

/** Krem paper with lacivert ink, the turquoise stripe for the route (brand section 2). */
export const LIGHT_PALETTE: MapPalette = {
  background: '#F6ECD2',
  earth: '#FFF8E7',
  water: '#BFE3EA',
  park: '#E3EBCB',
  building: '#EFE4C8',
  minorRoad: '#FFFFFF',
  majorRoad: '#F7D77A',
  routeCasing: '#14213D',
  route: '#2AB7CA',
  stopFill: '#FFF8E7',
  stopStroke: '#14213D',
};

/** Night lacivert base; roads stay dim so the route keeps the contrast. */
export const DARK_PALETTE: MapPalette = {
  background: '#101B33',
  earth: '#0B1428',
  water: '#06223A',
  park: '#10261F',
  building: '#16233F',
  minorRoad: '#22304F',
  majorRoad: '#3A3A2A',
  routeCasing: '#060D1D',
  route: '#2AB7CA',
  stopFill: '#F2B705',
  stopStroke: '#060D1D',
};

export interface StyleInput {
  palette: MapPalette;
  /** `pmtiles://…` URL of the city basemap, or `null` for the plain background. */
  basemapUrl: string | null;
  line: readonly LngLat[];
  stops: readonly LngLat[];
  /** Planner legs: rides drawn like a route, walks dashed. */
  segments?: readonly MapSegment[];
  /** Trip ends picked in the planner. */
  markers?: readonly MapMarker[];
}

export interface MapSegment {
  kind: 'ride' | 'walk';
  coordinates: readonly LngLat[];
}

export interface MapMarker {
  kind: 'from' | 'to';
  at: LngLat;
}

const kindIn = (...kinds: string[]): FilterSpecification => [
  'in',
  ['get', 'kind'],
  ['literal', kinds],
];

/**
 * Builds the style. The basemap layers follow the Protomaps basemap schema (`earth`, `water`,
 * `landuse`, `roads`, `buildings`) and draw no labels, so no glyph or sprite host is needed.
 * The route and stops come from one GeoJSON source and are drawn with or without the basemap.
 */
export function buildMapStyle(input: StyleInput): StyleSpecification {
  const { palette: p, basemapUrl } = input;
  const style: StyleSpecification = {
    version: 8,
    sources: {
      route: {
        type: 'geojson',
        data: routeFeatures(input.line, input.stops, input.segments ?? [], input.markers ?? []),
      },
    },
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': p.background } }],
  };
  if (basemapUrl) {
    style.sources['basemap'] = {
      type: 'vector',
      url: basemapUrl,
      attribution: '© OpenStreetMap',
    };
    style.layers.push(
      {
        id: 'earth',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'earth',
        paint: { 'fill-color': p.earth },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'landuse',
        filter: kindIn('park', 'forest', 'wood', 'grass', 'cemetery', 'garden'),
        paint: { 'fill-color': p.park },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        paint: { 'fill-color': p.water },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'buildings',
        minzoom: 14,
        paint: { 'fill-color': p.building },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        filter: kindIn('minor_road', 'other', 'path'),
        paint: {
          'line-color': p.minorRoad,
          'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.5, 16, 4],
        },
      },
      {
        id: 'roads-major',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        filter: kindIn('highway', 'major_road', 'medium_road'),
        paint: {
          'line-color': p.majorRoad,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 7],
        },
      },
    );
  }
  const planner = (input.segments?.length ?? 0) > 0 || (input.markers?.length ?? 0) > 0;
  if (planner) {
    style.layers.push({
      id: 'walk',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'role'], 'walk'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.routeCasing, 'line-width': 3, 'line-dasharray': [1, 1.6] },
    });
  }
  style.layers.push(
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      filter: IS_ROUTE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.routeCasing, 'line-width': 9 },
    },
    {
      id: 'route',
      type: 'line',
      source: 'route',
      filter: IS_ROUTE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': p.route, 'line-width': 5 },
    },
    {
      id: 'stops',
      type: 'circle',
      source: 'route',
      filter: ['==', ['get', 'role'], 'stop'],
      paint: {
        // A lone stop (stop page) is drawn larger than the stops along a route.
        'circle-radius': input.line.length >= 2 || planner ? 6 : 9,
        'circle-color': p.stopFill,
        'circle-stroke-color': p.stopStroke,
        'circle-stroke-width': 2.5,
      },
    },
  );
  if (planner) {
    style.layers.push({
      id: 'markers',
      type: 'circle',
      source: 'route',
      filter: ['in', ['get', 'role'], ['literal', ['from', 'to']]],
      paint: {
        'circle-radius': 9,
        'circle-color': ['match', ['get', 'role'], 'from', p.route, p.stopFill],
        'circle-stroke-color': p.routeCasing,
        'circle-stroke-width': 3,
      },
    });
  }
  return style;
}

const IS_ROUTE: FilterSpecification = ['in', ['get', 'role'], ['literal', ['route', 'ride']]];

type FeatureRole = 'route' | 'ride' | 'walk' | 'stop' | 'from' | 'to';

interface RouteFeature {
  type: 'Feature';
  properties: { role: FeatureRole };
  geometry:
    { type: 'LineString'; coordinates: number[][] } | { type: 'Point'; coordinates: number[] };
}

function routeFeatures(
  line: readonly LngLat[],
  stops: readonly LngLat[],
  segments: readonly MapSegment[],
  markers: readonly MapMarker[],
): { type: 'FeatureCollection'; features: RouteFeature[] } {
  const features: RouteFeature[] = [];
  const addLine = (role: FeatureRole, points: readonly LngLat[]) => {
    if (points.length < 2) return;
    features.push({
      type: 'Feature',
      properties: { role },
      geometry: { type: 'LineString', coordinates: points.map((p) => [...p]) },
    });
  };
  const addPoint = (role: FeatureRole, at: LngLat) => {
    features.push({
      type: 'Feature',
      properties: { role },
      geometry: { type: 'Point', coordinates: [...at] },
    });
  };
  addLine('route', line);
  for (const segment of segments) addLine(segment.kind, segment.coordinates);
  for (const stop of stops) addPoint('stop', stop);
  for (const marker of markers) addPoint(marker.kind, marker.at);
  return { type: 'FeatureCollection', features };
}

/** South-west and north-east corners around every coordinate, or `null` when there are none. */
export function boundsOf(points: readonly LngLat[]): [[number, number], [number, number]] | null {
  const valid = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (valid.length === 0) return null;
  const lngs = valid.map((p) => p[0] as number);
  const lats = valid.map((p) => p[1] as number);
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}
