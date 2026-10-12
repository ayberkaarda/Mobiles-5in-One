import { InjectionToken } from '@angular/core';
import type { LngLatBoundsLike, MapOptions, StyleSpecification } from 'maplibre-gl';

/** The part of a MapLibre map the wrapper uses; tests replace it with a fake. */
export interface MapHandle {
  on(type: 'load' | 'error', listener: (event: { sourceId?: string }) => void): unknown;
  setStyle(style: StyleSpecification): unknown;
  resize(): unknown;
  remove(): void;
}

export interface CreateMapOptions {
  container: HTMLElement;
  style: StyleSpecification;
  bounds?: LngLatBoundsLike;
  center?: [number, number];
  zoom?: number;
}

/** MapLibre plus the PMTiles protocol behind two calls, loaded as one lazy chunk. */
export interface MapLibrary {
  /**
   * True when the header of the `pmtiles://` archive can be read within the timeout; the archive
   * is then registered with the protocol and served to the map.
   */
  probeBasemap(url: string, timeoutMs: number): Promise<boolean>;
  /** Throws when the map cannot start, for example without WebGL. */
  createMap(options: CreateMapOptions): MapHandle;
}

type MaplibreModule = Pick<typeof import('maplibre-gl'), 'Map' | 'addProtocol' | 'setWorkerUrl'>;
type PmtilesModule = Pick<typeof import('pmtiles'), 'PMTiles' | 'Protocol'>;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
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

/**
 * Binds the two modules: one global `pmtiles://` protocol, the worker URL of the copied MapLibre
 * worker module, no attribution control (the wrapper renders its own attribution text) and no
 * rotation or pitch, which a route preview does not need.
 */
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
      // The style names the archive as pmtiles://<https url>; the archive itself is the https URL.
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
        container: options.container,
        style: options.style,
        attributionControl: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        scrollZoom: false,
        fitBoundsOptions: { padding: 36, maxZoom: 16 },
        ...(options.bounds ? { bounds: options.bounds } : {}),
        ...(options.center ? { center: options.center, zoom: options.zoom ?? 15 } : {}),
      };
      return new maplibre.Map(mapOptions);
    },
  };
}

/** The MapLibre worker module is copied next to the app by the build (`maplibre/`). */
export function workerUrlFor(baseUri: string): string {
  return new URL('maplibre/maplibre-gl-worker.mjs', baseUri).href;
}

let shared: Promise<MapLibrary> | null = null;

/** Loads MapLibre and PMTiles on first use; both stay out of the initial bundle. */
export function loadMapLibrary(baseUri: string): Promise<MapLibrary> {
  shared ??= Promise.all([import('maplibre-gl'), import('pmtiles')])
    .then(([maplibre, pmtiles]) => createMapLibrary(maplibre, pmtiles, workerUrlFor(baseUri)))
    .catch((error: unknown) => {
      shared = null;
      throw error;
    });
  return shared;
}

export const MAP_LIBRARY_LOADER = new InjectionToken<(baseUri: string) => Promise<MapLibrary>>(
  'MAP_LIBRARY_LOADER',
  { providedIn: 'root', factory: () => loadMapLibrary },
);
