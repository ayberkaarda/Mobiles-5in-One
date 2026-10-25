import type { FilterSpecification, StyleSpecification } from 'maplibre-gl';

type Location = readonly [number, number];
const kindIn = (...kinds: string[]): FilterSpecification => [
  'in',
  ['get', 'kind'],
  ['literal', kinds],
];

export function buildMapStyle(
  line: readonly Location[],
  stops: readonly Location[],
  basemapUrl: string | null,
  colors = {
    background: '#DADBD6',
    surface: '#FFFFFF',
    sunk: '#ECECEA',
    ink: '#1F2124',
    rail: '#B3261E',
    water: '#34557A',
    stop: '#FFFFFF',
  },
): StyleSpecification {
  const features: {
    type: 'Feature';
    properties: { role: string };
    geometry:
      { type: 'LineString'; coordinates: number[][] } | { type: 'Point'; coordinates: number[] };
  }[] = [];
  if (line.length >= 2)
    features.push({
      type: 'Feature',
      properties: { role: 'route' },
      geometry: { type: 'LineString', coordinates: line.map((point) => [...point]) },
    });
  for (const point of stops)
    features.push({
      type: 'Feature',
      properties: { role: 'stop' },
      geometry: { type: 'Point', coordinates: [...point] },
    });
  const style: StyleSpecification = {
    version: 8,
    sources: { route: { type: 'geojson', data: { type: 'FeatureCollection', features } } },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': colors.background } },
    ],
  };
  if (basemapUrl) {
    style.sources['basemap'] = { type: 'vector', url: basemapUrl };
    style.layers.push(
      {
        id: 'earth',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'earth',
        paint: { 'fill-color': colors.surface },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'landuse',
        filter: kindIn('park', 'forest', 'wood', 'grass', 'cemetery', 'garden'),
        paint: { 'fill-color': colors.sunk },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        paint: { 'fill-color': colors.water },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'buildings',
        minzoom: 14,
        paint: { 'fill-color': colors.sunk },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        filter: kindIn('minor_road', 'other', 'path'),
        paint: {
          'line-color': colors.surface,
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
          'line-color': colors.sunk,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 16, 7],
        },
      },
    );
  }
  style.layers.push(
    {
      id: 'route-casing',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'role'], 'route'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.ink, 'line-width': 9 },
    },
    {
      id: 'route',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'role'], 'route'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': colors.rail, 'line-width': 5 },
    },
    {
      id: 'stops',
      type: 'circle',
      source: 'route',
      filter: ['==', ['get', 'role'], 'stop'],
      paint: {
        'circle-radius': 6,
        'circle-color': colors.stop,
        'circle-stroke-color': colors.ink,
        'circle-stroke-width': 2.5,
      },
    },
  );
  return style;
}
export function boundsOf(points: readonly Location[]): [[number, number], [number, number]] | null {
  if (points.length === 0) return null;
  let west = Infinity,
    south = Infinity,
    east = -Infinity,
    north = -Infinity;
  for (const [lon, lat] of points) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return [
    [west, south],
    [east, north],
  ];
}
