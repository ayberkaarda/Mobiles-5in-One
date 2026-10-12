import { computed, inject, Injectable, signal } from '@angular/core';
import type { City } from '@inecekvar/data-access';
import { PackIndex, parsePack } from './pack-data';
import { PackFiles, PackManifest, sha256Hex } from './pack-storage';
import { PACK_STORAGE } from './pack-storage.provider';

/** A PMTiles `Source` (pmtiles 4): ranges of the archive by offset and length. */
export interface BasemapSource {
  getKey(): string;
  getBytes(offset: number, length: number): Promise<{ data: ArrayBuffer }>;
}

/**
 * The installed packs as the rest of the app sees them: the committed manifests, the parsed
 * dataset of a city (read once per install and checked against the manifest hash), the offline
 * city list and the basemap as a PMTiles source. Install and removal go through here so the
 * manifests and the dataset cache never disagree with storage.
 */
@Injectable({ providedIn: 'root' })
export class PackRegistry {
  private readonly storage = inject(PACK_STORAGE);
  private readonly datasets = new Map<string, Promise<PackIndex | null>>();
  private initOnce: Promise<void> | null = null;

  readonly kind = this.storage.kind;
  readonly manifests = signal<ReadonlyMap<string, PackManifest>>(new Map());
  readonly loaded = signal(false);
  /** Cities whose stored dataset no longer matched its manifest on reading. */
  readonly corrupt = signal<ReadonlySet<string>>(new Set());
  readonly list = computed(() =>
    [...this.manifests().values()].sort((a, b) => a.name.localeCompare(b.name, 'tr')),
  );

  /** Reads the manifests once; later calls reuse the first read. */
  ready(): Promise<void> {
    this.initOnce ??= this.refresh();
    return this.initOnce;
  }

  async refresh(): Promise<void> {
    try {
      const manifests = await this.storage.list();
      this.manifests.set(new Map(manifests.map((m) => [m.city, m])));
    } catch {
      this.manifests.set(new Map());
    } finally {
      this.loaded.set(true);
    }
  }

  manifest(city: string): PackManifest | null {
    return this.manifests().get(city) ?? null;
  }

  has(city: string | null | undefined): boolean {
    return !!city && this.manifests().has(city);
  }

  /** The parsed pack of a city, or `null` when none is installed or it cannot be read. */
  async dataset(city: string): Promise<PackIndex | null> {
    await this.ready();
    const manifest = this.manifest(city);
    if (!manifest) return null;
    const key = `${manifest.city}:${manifest.installId}`;
    let pending = this.datasets.get(key);
    if (!pending) {
      pending = this.load(manifest);
      this.datasets.set(key, pending);
      pending.then(
        (index) => index ?? this.datasets.delete(key),
        () => this.datasets.delete(key),
      );
    }
    return pending;
  }

  /** Cities with an installed pack, shaped like `GET cities`, for use without a connection. */
  async offlineCities(): Promise<City[]> {
    await this.ready();
    return this.list().map((m) => ({
      name: m.name,
      slug: m.city,
      is_sample: m.isSample,
      bbox: m.bbox,
      centroid: m.centroid,
      timezone: m.timezone,
      pack_version: m.packVersion,
      published_line_count: m.lineCount,
    }));
  }

  /** The installed basemap of a city as a PMTiles source, or `null`. */
  basemapSource(city: string): BasemapSource | null {
    const manifest = this.manifest(city);
    if (!manifest?.basemap) return null;
    return {
      getKey: () => `iv-pack/${city}/${manifest.installId}.pmtiles`,
      getBytes: async (offset, length) => {
        const bytes = await this.storage.readBasemap(city, offset, length);
        if (!bytes) throw new Error('basemap not installed');
        const data = new ArrayBuffer(bytes.length);
        new Uint8Array(data).set(bytes);
        return { data };
      },
    };
  }

  async install(manifest: PackManifest, files: PackFiles): Promise<void> {
    await this.ready();
    await this.storage.install(manifest, files);
    this.unmarkCorrupt(manifest.city);
    await this.refresh();
  }

  async remove(city: string): Promise<void> {
    await this.ready();
    await this.storage.remove(city);
    this.unmarkCorrupt(city);
    await this.refresh();
  }

  estimate() {
    return this.storage.estimate();
  }

  private async load(manifest: PackManifest): Promise<PackIndex | null> {
    try {
      const bytes = await this.storage.readDataset(manifest.city);
      if (!bytes) return null;
      if (
        bytes.length !== manifest.dataset.bytes ||
        (await sha256Hex(bytes)) !== manifest.dataset.sha256
      ) {
        this.corrupt.update((set) => new Set([...set, manifest.city]));
        return null;
      }
      return new PackIndex(parsePack(bytes, manifest.city));
    } catch {
      return null;
    }
  }

  private unmarkCorrupt(city: string): void {
    if (!this.corrupt().has(city)) return;
    this.corrupt.update((set) => new Set([...set].filter((c) => c !== city)));
  }
}
