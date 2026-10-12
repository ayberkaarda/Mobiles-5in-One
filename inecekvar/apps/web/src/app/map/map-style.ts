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
    layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#F6ECD2' } }],
  };
  if (basemapUrl) {
    style.sources['basemap'] = { type: 'vector', url: basemapUrl };
    style.layers.push(
      {
        id: 'earth',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'earth',
        paint: { 'fill-color': '#FFF8E7' },
      },
      {
        id: 'park',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'landuse',
        filter: kindIn('park', 'forest', 'wood', 'grass', 'cemetery', 'garden'),
        paint: { 'fill-color': '#E3EBCB' },
      },
      {
        id: 'water',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'water',
        paint: { 'fill-color': '#BFE3EA' },
      },
      {
        id: 'buildings',
        type: 'fill',
        source: 'basemap',
        'source-layer': 'buildings',
        minzoom: 14,
        paint: { 'fill-color': '#EFE4C8' },
      },
      {
        id: 'roads-minor',
        type: 'line',
        source: 'basemap',
        'source-layer': 'roads',
        filter: kindIn('minor_road', 'other', 'path'),
        paint: {
          'line-color': '#FFFFFF',
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
          'line-color': '#F7D77A',
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
      paint: { 'line-color': '#14213D', 'line-width': 9 },
    },
    {
      id: 'route',
      type: 'line',
      source: 'route',
      filter: ['==', ['get', 'role'], 'route'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#2AB7CA', 'line-width': 5 },
    },
    {
      id: 'stops',
      type: 'circle',
      source: 'route',
      filter: ['==', ['get', 'role'], 'stop'],
      paint: {
        'circle-radius': 6,
        'circle-color': '#FFF8E7',
        'circle-stroke-color': '#14213D',
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
