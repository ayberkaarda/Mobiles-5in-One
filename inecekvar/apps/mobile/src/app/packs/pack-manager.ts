import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { ApiBytes, ApiError, CatalogApi, City } from '@inecekvar/data-access';
import { CityStore } from '../city/city.store';
import { loadMapLibrary, workerUrlFor } from '../map/map-library';
import { PackFormatError, parsePack } from './pack-data';
import { PackRegistry } from './pack-registry';
import {
  fileInfo,
  newInstallId,
  originEstimate,
  PackManifest,
  PackStorageError,
  PackStorageEstimate,
} from './pack-storage';

export type PackPhase = 'dataset' | 'basemap' | 'saving';

export interface PackJob {
  phase: PackPhase;
  received: number;
  /** Declared size of the file being downloaded, or `null` when the server did not say. */
  total: number | null;
}

export type PackFailureKind =
  'entitlement' | 'rate_limited' | 'offline' | 'quota' | 'integrity' | 'invalid' | 'error';

export interface PackFailure {
  kind: PackFailureKind;
  retryAfterSeconds: number | null;
}

/** How a city row of the pack manager looks right now. */
export type PackRowState = 'none' | 'working' | 'installed' | 'update';

/**
 * Caches what the map needs offline: the map component and MapLibre chunks (through the service
 * worker's lazy `map` group) and the MapLibre worker modules. Called after an install.
 */
export const MAP_WARMUP = new InjectionToken<() => Promise<void>>('MAP_WARMUP', {
  providedIn: 'root',
  factory: () => {
    const baseUri = inject(DOCUMENT).baseURI;
    return async () => {
      const worker = workerUrlFor(baseUri);
      await Promise.allSettled([
        import('../map/map.component'),
        loadMapLibrary(baseUri),
        fetch(worker),
        fetch(worker.replace('maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs')),
      ]);
    };
  },
});

/** Head room asked for beyond the downloaded bytes before writing (write amplification). */
const QUOTA_MARGIN = 1.2;
/** `PMTiles` followed by spec version 3. */
const PMTILES_MAGIC = [0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73];

export function isPmtilesV3(bytes: Uint8Array): boolean {
  return bytes.length >= 127 && PMTILES_MAGIC.every((b, i) => bytes[i] === b) && bytes[7] === 3;
}

export function failureOf(error: unknown): PackFailure {
  const kind = ((): PackFailureKind => {
    if (error instanceof ApiError) {
      if (
        error.status === 402 ||
        (error.status === 403 && error.code === 'pack.entitlement_required')
      ) {
        return 'entitlement';
      }
      if (error.status === 429) return 'rate_limited';
      if (error.kind === 'network' || error.kind === 'timeout') return 'offline';
      return 'error';
    }
    if (error instanceof PackStorageError) {
      if (error.kind === 'quota') return 'quota';
      if (error.kind === 'integrity') return 'integrity';
      return 'error';
    }
    if (error instanceof PackFormatError) return 'invalid';
    return 'error';
  })();
  const retryAfterSeconds = error instanceof ApiError ? error.retryAfterSeconds : null;
  return { kind, retryAfterSeconds };
}

const isAbort = (error: unknown) => error instanceof ApiError && error.kind === 'aborted';

/**
 * Downloads, updates and removes offline city packs. A download fetches the dataset with
 * progress, checks its declared length and format, then tries the city's PMTiles basemap (a
 * city without one installs without it), checks the storage quota and hands both files to the
 * registry, which writes, verifies and swaps them atomically. Cancelling aborts the download;
 * nothing is written until both files are complete. The API enforces the free city and Plus;
 * a refusal is kept per city for the UI to explain.
 */
@Injectable({ providedIn: 'root' })
export class PackManager {
  private readonly api = inject(CatalogApi);
  private readonly registry = inject(PackRegistry);
  private readonly cityStore = inject(CityStore);
  private readonly warmMap = inject(MAP_WARMUP);
  private readonly controllers = new Map<string, AbortController>();

  readonly jobs = signal<ReadonlyMap<string, PackJob>>(new Map());
  readonly failures = signal<ReadonlyMap<string, PackFailure>>(new Map());
  readonly estimate = signal<PackStorageEstimate | null>(null);

  /** Installed packs older than the city's current `pack_version`. */
  readonly updates = computed(() =>
    this.cityStore.cities().filter((city) => this.updateAvailable(city)),
  );

  updateAvailable(city: City): boolean {
    const manifest = this.registry.manifests().get(city.slug);
    return !!manifest && city.pack_version > manifest.packVersion;
  }

  state(city: City): PackRowState {
    if (this.jobs().has(city.slug)) return 'working';
    if (!this.registry.manifests().has(city.slug)) return 'none';
    return this.updateAvailable(city) ? 'update' : 'installed';
  }

  async refreshEstimate(): Promise<void> {
    try {
      this.estimate.set(await this.registry.estimate());
    } catch {
      this.estimate.set(null);
    }
  }

  cancel(city: string): void {
    this.controllers.get(city)?.abort();
  }

  async remove(city: string): Promise<void> {
    this.cancel(city);
    this.clearFailure(city);
    try {
      await this.registry.remove(city);
    } catch (error) {
      this.setFailure(city, failureOf(error));
    }
    await this.refreshEstimate();
  }

  /** Installs or updates the pack of `city`; resolves when done, failed or cancelled. */
  async download(city: string): Promise<boolean> {
    if (this.controllers.has(city)) return false;
    const controller = new AbortController();
    this.controllers.set(city, controller);
    this.clearFailure(city);
    const progress = (phase: PackPhase) => (received: number, total: number | null) =>
      this.setJob(city, { phase, received, total });
    progress('dataset')(0, null);
    try {
      await this.registry.ready();
      const dataset = await this.api.packBytes(city, {
        signal: controller.signal,
        onProgress: progress('dataset'),
      });
      checkLength('dataset', dataset);
      const data = parsePack(dataset.bytes, city);
      const basemap = await this.fetchBasemap(city, controller.signal, progress('basemap'));
      this.setJob(city, { phase: 'saving', received: 0, total: null });
      const needed = dataset.bytes.length + (basemap?.length ?? 0);
      await checkQuota(needed);
      const manifest: PackManifest = {
        city,
        name: data.city.name,
        isSample: data.city.is_sample,
        bbox: data.city.bbox,
        centroid: data.city.centroid,
        timezone: data.city.timezone,
        packVersion: data.pack_version,
        lineCount: data.lines.length,
        stopCount: data.stops.length,
        dataset: await fileInfo(dataset.bytes),
        basemap: basemap ? await fileInfo(basemap) : null,
        installedAt: new Date().toISOString(),
        installId: newInstallId(),
      };
      await this.registry.install(manifest, { dataset: dataset.bytes, basemap });
      void this.warmMap().catch(() => undefined);
      return true;
    } catch (error) {
      if (!isAbort(error)) this.setFailure(city, failureOf(error));
      return false;
    } finally {
      this.controllers.delete(city);
      this.jobs.update((jobs) => {
        const next = new Map(jobs);
        next.delete(city);
        return next;
      });
      await this.refreshEstimate();
    }
  }

  /**
   * The basemap archive, or `null` when the city has none (404), the tiles host cannot be
   * reached or the body is not a PMTiles v3 archive: the pack still installs and the map falls
   * back to the plain background. Cancelling still aborts.
   */
  private async fetchBasemap(
    city: string,
    signal: AbortSignal,
    onProgress: (received: number, total: number | null) => void,
  ): Promise<Uint8Array | null> {
    try {
      const archive = await this.api.tilesArchive(city, { signal, onProgress });
      checkLength('basemap', archive);
      return isPmtilesV3(archive.bytes) ? archive.bytes : null;
    } catch (error) {
      if (isAbort(error) || signal.aborted) throw error;
      if (error instanceof PackStorageError) throw error;
      return null;
    }
  }

  private setJob(city: string, job: PackJob): void {
    this.jobs.update((jobs) => new Map(jobs).set(city, job));
  }

  private setFailure(city: string, failure: PackFailure): void {
    this.failures.update((all) => new Map(all).set(city, failure));
  }

  private clearFailure(city: string): void {
    if (!this.failures().has(city)) return;
    this.failures.update((all) => {
      const next = new Map(all);
      next.delete(city);
      return next;
    });
  }
}

function checkLength(label: string, body: ApiBytes): void {
  if (body.declaredLength !== null && body.declaredLength !== body.bytes.length) {
    throw new PackStorageError(
      'integrity',
      `${label}: received length differs from Content-Length`,
    );
  }
}

async function checkQuota(needed: number): Promise<void> {
  const { usage, quota } = await originEstimate();
  if (usage !== null && quota !== null && quota - usage < needed * QUOTA_MARGIN) {
    throw new PackStorageError('quota', 'not enough storage for the pack');
  }
}
