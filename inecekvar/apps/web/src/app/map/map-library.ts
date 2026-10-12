import type { LngLatBoundsLike, MapOptions, StyleSpecification } from 'maplibre-gl';

export interface MapHandle {
  on(type: 'load' | 'error', listener: (event: { sourceId?: string }) => void): unknown;
  setStyle(style: StyleSpecification): unknown;
  fitBounds(bounds: LngLatBoundsLike, options?: { padding?: number; maxZoom?: number }): unknown;
  remove(): void;
}
export interface MapLibrary {
  probeBasemap(url: string, timeoutMs: number): Promise<boolean>;
  createMap(options: { container: HTMLElement; style: StyleSpecification }): MapHandle;
}
type MaplibreModule = Pick<typeof import('maplibre-gl'), 'Map' | 'addProtocol' | 'setWorkerUrl'>;
type PmtilesModule = Pick<typeof import('pmtiles'), 'PMTiles' | 'Protocol'>;

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
export function createMapLibrary(
  maplibre: MaplibreModule,
  pmtiles: PmtilesModule,
  workerUrl: string,
): MapLibrary {
  maplibre.setWorkerUrl(workerUrl);
  const protocol = new pmtiles.Protocol();
  maplibre.addProtocol('pmtiles', protocol.tile);
  return {
    async probeBasemap(url, timeoutMs) {
      const archive = new pmtiles.PMTiles(url.replace(/^pmtiles:\/\//, ''));
      try {
        await withTimeout(archive.getHeader(), timeoutMs);
        protocol.add(archive);
        return true;
      } catch {
        return false;
      }
    },
    createMap(options) {
      const mapOptions: MapOptions = {
        ...options,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        scrollZoom: false,
      };
      return new maplibre.Map(mapOptions);
    },
  };
}
export function workerUrlFor(baseUri: string): string {
  return new URL('maplibre/maplibre-gl-worker.mjs', baseUri).href;
}
export function basemapUrlFor(tilesOrigin: string, city: string): string {
  return `pmtiles://${tilesOrigin.replace(/\/+$/, '')}/${encodeURIComponent(city)}.pmtiles`;
}
let shared: Promise<MapLibrary> | null = null;
export function loadMapLibrary(baseUri: string): Promise<MapLibrary> {
  shared ??= Promise.all([import('maplibre-gl'), import('pmtiles')])
    .then(([maplibre, pmtiles]) => createMapLibrary(maplibre, pmtiles, workerUrlFor(baseUri)))
    .catch((error: unknown) => {
      shared = null;
      throw error;
    });
  return shared;
}
