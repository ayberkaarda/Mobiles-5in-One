import {
  asStorageError,
  isManifest,
  originEstimate,
  PackFiles,
  PackManifest,
  packBytesOf,
  PackStorage,
  PackStorageError,
  PackStorageEstimate,
  throwIfAborted,
  verifyFile,
} from './pack-storage';

/** The part of `Cache` the storage uses; tests pass a fake. */
export interface CacheLike {
  put(request: string, response: Response): Promise<void>;
  match(request: string): Promise<Response | undefined>;
}

/** The part of `CacheStorage` the storage uses. */
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  delete(name: string): Promise<boolean>;
  keys(): Promise<string[]>;
}

export const INDEX_CACHE = 'iv-packs-index';
export const INSTALL_CACHE_PREFIX = 'iv-pack:';
const INDEX_KEY = '/__iv-packs/index.json';

export type IndexLock = <T>(step: () => Promise<T>) => Promise<T>;

export interface PackInvalidation {
  publish(): void;
  subscribe(listener: () => void): () => void;
}

export const browserIndexLock: IndexLock = (step) => {
  const locks = globalThis.navigator?.locks;
  return locks ? locks.request('iv-packs-index', step) : step();
};

function browserInvalidation(): PackInvalidation {
  const listeners = new Set<() => void>();
  let channel: BroadcastChannel | null = null;
  const open = () => {
    if (!channel && typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
      try {
        channel = new BroadcastChannel('iv-packs');
        channel.onmessage = () => listeners.forEach((listener) => listener());
      } catch {
        channel = null;
      }
    }
    return channel;
  };
  return {
    publish: () => {
      const sender = open();
      sender?.postMessage('changed');
      if (listeners.size === 0) {
        sender?.close();
        channel = null;
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      open();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          channel?.close();
          channel = null;
        }
      };
    },
  };
}

interface PackIndexFile {
  version: 1;
  packs: PackManifest[];
}

const installCache = (m: Pick<PackManifest, 'city' | 'installId'>) =>
  `${INSTALL_CACHE_PREFIX}${m.city}:${m.installId}`;
const fileKey = (m: Pick<PackManifest, 'city' | 'installId'>, file: string) =>
  `/__iv-packs/${m.city}/${m.installId}/${file}`;

/**
 * PWA storage in Cache Storage. Each install gets its own cache (`iv-pack:<city>:<installId>`);
 * the index cache holds one JSON entry listing the committed manifests. Installing writes the
 * new cache, reads it back and checks it, then replaces the index entry in a single `put` (the
 * swap); the old cache is deleted afterwards. Caches no index entry points to are leftovers of
 * interrupted installs and are deleted by `list`. The service worker's own caches (`ngsw:`)
 * are never touched. Index writes are serialized within the app.
 */
export class CachePackStorage implements PackStorage {
  readonly kind = 'cache-storage' as const;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly blobs = new Map<string, Promise<Blob | null>>();
  private readonly active = new Set<string>();
  private lastGood: PackIndexFile = { version: 1, packs: [] };

  constructor(
    private readonly caches: CacheStorageLike,
    private readonly lock: IndexLock = browserIndexLock,
    private readonly invalidation: PackInvalidation = browserInvalidation(),
  ) {}

  subscribeInvalidation(listener: () => void): () => void {
    return this.invalidation.subscribe(listener);
  }

  async list(): Promise<PackManifest[]> {
    return this.serial(async () => {
      let index: PackIndexFile;
      try {
        index = await this.readIndex();
      } catch {
        return this.lastGood.packs;
      }
      const live = new Set(index.packs.map(installCache));
      for (const key of this.blobs.keys()) {
        if (!live.has(key)) this.blobs.delete(key);
      }
      if (this.active.size > 0) return index.packs;
      try {
        for (const name of await this.caches.keys()) {
          if (name.startsWith(INSTALL_CACHE_PREFIX) && !live.has(name) && !this.active.has(name)) {
            await this.caches.delete(name);
          }
        }
      } catch {
        // Cleanup is best effort; the next list tries again.
      }
      return index.packs;
    });
  }

  async readDataset(city: string): Promise<Uint8Array | null> {
    const manifest = await this.committed(city);
    if (!manifest) return null;
    const cache = await this.caches.open(installCache(manifest));
    const response = await cache.match(fileKey(manifest, 'dataset.json'));
    return response ? new Uint8Array(await response.arrayBuffer()) : null;
  }

  async readBasemap(
    city: string,
    offset: number,
    length: number,
    installId?: string,
  ): Promise<Uint8Array | null> {
    return this.serial(async () => {
      const manifest = (await this.readIndex()).packs.find((p) => p.city === city);
      if (installId && manifest?.installId !== installId) return null;
      if (!manifest?.basemap) return null;
      const key = installCache(manifest);
      let blob = this.blobs.get(key);
      if (!blob) {
        blob = this.caches
          .open(key)
          .then((cache) => cache.match(fileKey(manifest, 'basemap.pmtiles')))
          .then((response) => (response ? response.blob() : null));
        this.blobs.set(key, blob);
      }
      const file = await blob;
      if (!file) {
        this.blobs.delete(key);
        return null;
      }
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    });
  }

  async install(manifest: PackManifest, files: PackFiles, signal?: AbortSignal): Promise<void> {
    return this.serial(async () => {
      if (manifest.basemap && !files.basemap) {
        throw new PackStorageError('integrity', 'basemap missing');
      }
      const name = installCache(manifest);
      const index = await this.readIndex();
      const previous = index.packs.find((p) => p.city === manifest.city);
      if (previous && previous.packVersion > manifest.packVersion) {
        throw new PackStorageError('integrity', 'a newer pack is already installed');
      }
      throwIfAborted(signal);
      this.active.add(name);
      let committed = false;
      try {
        const cache = await this.caches.open(name);
        await cache.put(fileKey(manifest, 'dataset.json'), bytesResponse(files.dataset, 'json'));
        throwIfAborted(signal);
        if (manifest.basemap && files.basemap) {
          await cache.put(
            fileKey(manifest, 'basemap.pmtiles'),
            bytesResponse(files.basemap, 'pmtiles'),
          );
        }
        throwIfAborted(signal);
        // Read back what was stored before anything points to it.
        await verifyFile(
          'dataset',
          await read(cache, fileKey(manifest, 'dataset.json')),
          manifest.dataset,
        );
        if (manifest.basemap) {
          await verifyFile(
            'basemap',
            await read(cache, fileKey(manifest, 'basemap.pmtiles')),
            manifest.basemap,
          );
        }
        throwIfAborted(signal);
        const packs = index.packs.filter((p) => p.city !== manifest.city);
        packs.push(manifest);
        await this.writeIndex({ version: 1, packs }, signal);
        committed = true;
        if (signal?.aborted) {
          await this.writeIndex(index);
          committed = false;
          throwIfAborted(signal);
        }
      } catch (error) {
        if (!committed) await this.caches.delete(name).catch(() => false);
        throw asStorageError(error, 'install failed');
      } finally {
        this.active.delete(name);
      }
      if (previous && previous.installId !== manifest.installId) {
        this.blobs.delete(installCache(previous));
        await this.caches.delete(installCache(previous)).catch(() => false);
      }
      this.invalidation.publish();
    });
  }

  async remove(city: string): Promise<void> {
    await this.serial(async () => {
      const index = await this.readIndex();
      const removed = index.packs.find((p) => p.city === city);
      if (!removed) return;
      await this.writeIndex({ version: 1, packs: index.packs.filter((p) => p.city !== city) });
      this.blobs.delete(installCache(removed));
      await this.caches.delete(installCache(removed)).catch(() => false);
      this.invalidation.publish();
    });
  }

  async estimate(): Promise<PackStorageEstimate> {
    const packs = packBytesOf((await this.serial(() => this.readIndex())).packs);
    return { packs, ...(await originEstimate()) };
  }

  private async committed(city: string): Promise<PackManifest | undefined> {
    const index = await this.serial(() => this.readIndex());
    return index.packs.find((p) => p.city === city);
  }

  private async readIndex(): Promise<PackIndexFile> {
    try {
      const cache = await this.caches.open(INDEX_CACHE);
      const response = await cache.match(INDEX_KEY);
      if (!response) return (this.lastGood = { version: 1, packs: [] });
      const parsed = (await response.json()) as Partial<PackIndexFile>;
      if (parsed.version !== 1 || !Array.isArray(parsed.packs) || !parsed.packs.every(isManifest)) {
        throw new PackStorageError('io', 'pack index is unreadable');
      }
      return (this.lastGood = { version: 1, packs: parsed.packs });
    } catch (error) {
      throw new PackStorageError('io', 'pack index is unreadable', error);
    }
  }

  private async writeIndex(index: PackIndexFile, signal?: AbortSignal): Promise<void> {
    const cache = await this.caches.open(INDEX_CACHE);
    throwIfAborted(signal);
    await cache.put(
      INDEX_KEY,
      new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } }),
    );
    this.lastGood = index;
  }

  /** Runs index read-modify-write steps one at a time. */
  private serial<T>(step: () => Promise<T>): Promise<T> {
    const locked = () => this.lock(step);
    const run = this.queue.then(locked, locked);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function bytesResponse(bytes: Uint8Array, kind: 'json' | 'pmtiles'): Response {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Response(copy, {
    headers: {
      'Content-Type': kind === 'json' ? 'application/json' : 'application/vnd.pmtiles',
      'Content-Length': String(bytes.length),
    },
  });
}

async function read(cache: CacheLike, key: string): Promise<Uint8Array | null> {
  const response = await cache.match(key);
  return response ? new Uint8Array(await response.arrayBuffer()) : null;
}

/** The browser's Cache Storage, with request keys resolved against the page. */
export function browserCaches(): CacheStorageLike {
  const storage = globalThis.caches;
  return {
    open: async (name) => {
      const cache = await storage.open(name);
      return {
        put: (request, response) => cache.put(request, response),
        match: (request) => cache.match(request),
      };
    },
    delete: (name) => storage.delete(name),
    keys: () => storage.keys(),
  };
}
