import { Directory } from '@capacitor/filesystem';
import { packBody, samplePackData } from '../testing/catalog.fixtures';
import {
  deferred,
  FakeCacheStorage,
  FakeFilesystem,
  fakePmtiles,
  quotaError,
} from '../testing/pack.fakes';
import {
  CachePackStorage,
  browserIndexLock,
  INDEX_CACHE,
  IndexLock,
  INSTALL_CACHE_PREFIX,
} from './cache-pack-storage';
import {
  createRangeReader,
  FilesystemPackStorage,
  isMissingFile,
  toBase64,
} from './filesystem-pack-storage';
import {
  choosePackStorage,
  fileInfo,
  isQuotaError,
  MemoryPackStorage,
  PackFiles,
  PackManifest,
  PackStorage,
  PackStorageError,
} from './pack-storage';

const CITY = 'ornek-test-sehri';
let seq = 0;

async function packFiles(
  version: number,
  basemap = false,
): Promise<{
  manifest: PackManifest;
  files: PackFiles;
}> {
  const dataset = packBody(samplePackData(version)).bytes;
  const tiles = basemap ? fakePmtiles(200 + version) : null;
  seq += 1;
  return {
    files: { dataset, basemap: tiles },
    manifest: {
      city: CITY,
      name: 'Örnek',
      isSample: true,
      bbox: [34, 42.5, 34.1, 42.58],
      centroid: [34.05, 42.54],
      timezone: 'Europe/Istanbul',
      packVersion: version,
      lineCount: 3,
      stopCount: 20,
      dataset: await fileInfo(dataset),
      basemap: tiles ? await fileInfo(tiles) : null,
      installedAt: '2026-10-12T10:00:00Z',
      installId: `install-${String(seq).padStart(4, '0')}`,
    },
  };
}

async function failure(promise: Promise<unknown>): Promise<PackStorageError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PackStorageError) return error;
    throw error;
  }
  throw new Error('expected a failure');
}

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);
const versionOf = (bytes: Uint8Array | null) =>
  bytes ? (JSON.parse(text(bytes) ?? '{}') as { pack_version: number }).pack_version : null;

interface Harness {
  storage: PackStorage;
  /** Makes the next writes whose key ends with `file` throw `error`. */
  failWrites(file: string, error: Error): void;
  /** Flips a byte in writes whose key ends with `file`. */
  corruptWrites(file: string): void;
  clearFaults(): void;
  /** Storage locations holding files, for leak checks. */
  locations(): string[];
  /** Leaves files of an install that never reached the index (a crash mid-download). */
  orphan(): Promise<void>;
  /** A second storage over the same backing store (an app restart). */
  reopen(): PackStorage;
  beforeWrite(step: (key: string) => Promise<void>): void;
  unreadableIndex(kind: 'read-error' | 'invalid-json'): void;
}

function cacheHarness(): Harness {
  const backing = new FakeCacheStorage();
  const make = () => new CachePackStorage(backing);
  return {
    storage: make(),
    failWrites: (file, error) =>
      (backing.faults.fail = (key) => (key.endsWith(file) ? error : null)),
    corruptWrites: (file) => (backing.faults.corrupt = (key) => key.endsWith(file)),
    clearFaults: () => (backing.faults = {}),
    locations: () =>
      [...backing.caches.keys()].filter((n) => n.startsWith(INSTALL_CACHE_PREFIX)).sort(),
    orphan: async () => {
      const cache = await backing.open(`${INSTALL_CACHE_PREFIX}${CITY}:crashed-0001`);
      await cache.put('/__iv-packs/x/dataset.json', new Response('{'));
    },
    reopen: make,
    beforeWrite: (step) => (backing.faults.before = step),
    unreadableIndex: (kind) => {
      if (kind === 'read-error') {
        backing.faults.readFail = (key) =>
          key.endsWith('index.json') ? new Error('index I/O failure') : null;
      } else {
        backing.caches.get(INDEX_CACHE)?.set('/__iv-packs/index.json', {
          bytes: new TextEncoder().encode('{'),
          type: 'application/json',
        });
      }
    },
  };
}

function filesystemHarness(): Harness {
  const fs = new FakeFilesystem();
  const make = () => new FilesystemPackStorage(fs, fs.readRange, Directory.Data);
  return {
    storage: make(),
    failWrites: (file, error) => (fs.faults.fail = (key) => (key.endsWith(file) ? error : null)),
    corruptWrites: (file) => (fs.faults.corrupt = (key) => key.endsWith(file)),
    clearFaults: () => (fs.faults = {}),
    locations: () => fs.installDirs(),
    orphan: async () => {
      await fs.writeFile({
        path: `packs/${CITY}/crashed-0001/dataset.json`,
        data: btoa('{'),
        directory: Directory.Data,
      });
    },
    reopen: make,
    beforeWrite: (step) => (fs.faults.before = step),
    unreadableIndex: (kind) => {
      if (kind === 'read-error') {
        fs.faults.readFail = (key) =>
          key === 'packs/index.json' ? new Error('index I/O failure') : null;
      } else {
        fs.files.set('packs/index.json', btoa('{'));
      }
    },
  };
}

describe.each([
  ['Cache Storage', cacheHarness],
  ['Filesystem', filesystemHarness],
])('%s pack storage', (_name, harness) => {
  it('keeps staged files when list runs during a deferred install write', async () => {
    const h = harness();
    const pack = await packFiles(1, true);
    const entered = deferred<void>();
    const release = deferred<void>();
    h.beforeWrite(async (key) => {
      if (key.endsWith('basemap.pmtiles')) {
        entered.resolve();
        await release.promise;
      }
    });
    const installing = h.storage.install(pack.manifest, pack.files);
    await entered.promise;
    let listed = false;
    const listing = h.storage.list().then((packs) => {
      listed = true;
      return packs;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(listed).toBe(false);
    release.resolve();
    await installing;
    expect(await listing).toEqual([pack.manifest]);
    const dataset = await h.storage.readDataset(CITY);
    const basemap = await h.storage.readBasemap(CITY, 0, 8);
    expect([...(dataset ?? [])]).toEqual([...pack.files.dataset]);
    expect([...(basemap ?? [])]).toEqual([...(pack.files.basemap?.slice(0, 8) ?? [])]);
  });

  it.each(['read-error', 'invalid-json'] as const)(
    'preserves install files and refuses mutations with an unreadable %s index',
    async (kind) => {
      const h = harness();
      const first = await packFiles(1);
      await h.storage.install(first.manifest, first.files);
      const locations = h.locations();
      h.unreadableIndex(kind);
      await h.reopen().list();
      expect(h.locations()).toEqual(locations);
      const next = await packFiles(2);
      expect((await failure(h.storage.install(next.manifest, next.files))).kind).toBe('io');
      expect((await failure(h.storage.remove(CITY))).kind).toBe('io');
      expect(h.locations()).toEqual(locations);
    },
  );

  it('cancels a staged update before commit and retains the previous install', async () => {
    const h = harness();
    const first = await packFiles(1);
    await h.storage.install(first.manifest, first.files);
    const next = await packFiles(2);
    const entered = deferred<void>();
    const release = deferred<void>();
    h.beforeWrite(async (key) => {
      if (key.endsWith('dataset.json')) {
        entered.resolve();
        await release.promise;
      }
    });
    const controller = new AbortController();
    const installing = failure(h.storage.install(next.manifest, next.files, controller.signal));
    await entered.promise;
    controller.abort();
    release.resolve();
    expect((await installing).kind).toBe('aborted');
    expect(await h.storage.list()).toEqual([first.manifest]);
    expect(h.locations()).toEqual([expect.stringContaining(first.manifest.installId)]);
  });

  it('cancels an update while the index write is pending and restores the old index', async () => {
    const h = harness();
    const first = await packFiles(1);
    await h.storage.install(first.manifest, first.files);
    const next = await packFiles(2);
    const entered = deferred<void>();
    const release = deferred<void>();
    h.beforeWrite(async (key) => {
      if (key.endsWith('index.json') || key.endsWith('index.next.json')) {
        entered.resolve();
        await release.promise;
      }
    });
    const controller = new AbortController();
    const installing = failure(h.storage.install(next.manifest, next.files, controller.signal));
    await entered.promise;
    controller.abort();
    release.resolve();
    expect((await installing).kind).toBe('aborted');
    expect(await h.storage.list()).toEqual([first.manifest]);
    expect(h.locations()).toEqual([expect.stringContaining(first.manifest.installId)]);
  });

  it('never serves the replacement archive for an obsolete install generation', async () => {
    const h = harness();
    const first = await packFiles(1, true);
    const next = await packFiles(2, true);
    await h.storage.install(first.manifest, first.files);
    await h.storage.install(next.manifest, next.files);
    expect(await h.storage.readBasemap(CITY, 0, 8, first.manifest.installId)).toBeNull();
    expect(await h.storage.readBasemap(CITY, 0, 8, next.manifest.installId)).toEqual(
      next.files.basemap?.slice(0, 8),
    );
  });

  it('installs, lists, reads back and survives a restart', async () => {
    const h = harness();
    const { manifest, files } = await packFiles(1, true);
    await h.storage.install(manifest, files);
    const again = h.reopen();
    expect((await again.list()).map((m) => m.installId)).toEqual([manifest.installId]);
    expect(versionOf(await again.readDataset(CITY))).toBe(1);
    const head = await again.readBasemap(CITY, 0, 7);
    expect(text(head)).toBe('PMTiles');
    const tiles = files.basemap ?? new Uint8Array(0);
    const tail = await again.readBasemap(CITY, tiles.length - 4, 100);
    expect([...(tail ?? [])]).toEqual([...tiles.slice(-4)]);
    expect((await again.estimate()).packs).toBe(files.dataset.length + tiles.length);
  });

  it('swaps an update atomically and removes the old files afterwards', async () => {
    const h = harness();
    const v1 = await packFiles(1);
    const v2 = await packFiles(2);
    await h.storage.install(v1.manifest, v1.files);
    await h.storage.install(v2.manifest, v2.files);
    expect(versionOf(await h.storage.readDataset(CITY))).toBe(2);
    expect((await h.storage.list()).map((m) => m.packVersion)).toEqual([2]);
    expect(h.locations()).toHaveLength(1);
    expect(h.locations()[0]).toContain(v2.manifest.installId);
  });

  it('keeps the good pack when a write fails midway and leaves no partial files', async () => {
    const h = harness();
    const v1 = await packFiles(1);
    await h.storage.install(v1.manifest, v1.files);
    const v2 = await packFiles(2, true);
    h.failWrites('basemap.pmtiles', new Error('I/O error'));
    const error = await failure(h.storage.install(v2.manifest, v2.files));
    expect(error.kind).toBe('io');
    h.clearFaults();
    expect(versionOf(await h.storage.readDataset(CITY))).toBe(1);
    expect((await h.reopen().list()).map((m) => m.installId)).toEqual([v1.manifest.installId]);
    expect(h.locations()).toEqual([expect.stringContaining(v1.manifest.installId)]);
  });

  it('refuses what does not read back as written and keeps the good pack', async () => {
    const h = harness();
    const v1 = await packFiles(1);
    await h.storage.install(v1.manifest, v1.files);
    const v2 = await packFiles(2);
    h.corruptWrites('dataset.json');
    const error = await failure(h.storage.install(v2.manifest, v2.files));
    expect(error.kind).toBe('integrity');
    h.clearFaults();
    expect(versionOf(await h.storage.readDataset(CITY))).toBe(1);
    expect(h.locations()).toHaveLength(1);
  });

  it('reports a full device as a quota error and changes nothing', async () => {
    const h = harness();
    const v1 = await packFiles(1);
    await h.storage.install(v1.manifest, v1.files);
    const v2 = await packFiles(2);
    h.failWrites('dataset.json', quotaError());
    const error = await failure(h.storage.install(v2.manifest, v2.files));
    expect(error.kind).toBe('quota');
    h.clearFaults();
    expect(versionOf(await h.storage.readDataset(CITY))).toBe(1);
  });

  it('refuses a manifest that does not describe the files', async () => {
    const h = harness();
    const v1 = await packFiles(1);
    const wrong = { ...v1.manifest, dataset: { ...v1.manifest.dataset, bytes: 1 } };
    expect((await failure(h.storage.install(wrong, v1.files))).kind).toBe('integrity');
    expect(await h.storage.list()).toEqual([]);
    expect(h.locations()).toEqual([]);
  });

  it('cleans up files of an install that never reached the index', async () => {
    const h = harness();
    const v1 = await packFiles(1);
    await h.storage.install(v1.manifest, v1.files);
    await h.orphan();
    expect(h.locations()).toHaveLength(2);
    await h.reopen().list();
    expect(h.locations()).toEqual([expect.stringContaining(v1.manifest.installId)]);
  });

  it('removes a pack', async () => {
    const h = harness();
    const v1 = await packFiles(1, true);
    await h.storage.install(v1.manifest, v1.files);
    await h.storage.remove(CITY);
    expect(await h.storage.list()).toEqual([]);
    expect(await h.storage.readDataset(CITY)).toBeNull();
    expect(await h.storage.readBasemap(CITY, 0, 10)).toBeNull();
    expect(h.locations()).toEqual([]);
  });
});

describe('Cache Storage specifics', () => {
  it('uses the named browser Web Lock for pack index operations', async () => {
    const request = vi.fn(async (_name: string, step: () => Promise<unknown>) => step());
    vi.stubGlobal('navigator', { locks: { request } });
    try {
      expect(await browserIndexLock(async () => 7)).toBe(7);
      expect(request).toHaveBeenCalledWith('iv-packs-index', expect.any(Function));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps a cache generation alive until its in-flight basemap read finishes', async () => {
    const backing = new FakeCacheStorage();
    const storage = new CachePackStorage(backing);
    const first = await packFiles(1, true);
    const next = await packFiles(2, true);
    const firstCache = `${INSTALL_CACHE_PREFIX}${CITY}:${first.manifest.installId}`;
    const nextCache = `${INSTALL_CACHE_PREFIX}${CITY}:${next.manifest.installId}`;
    await storage.install(first.manifest, first.files);
    const entered = deferred<void>();
    const release = deferred<void>();
    backing.faults.beforeRead = async (key) => {
      if (key.endsWith('basemap.pmtiles') && key.includes(first.manifest.installId)) {
        entered.resolve();
        await release.promise;
      }
    };
    const reading = storage.readBasemap(CITY, 127, 10, first.manifest.installId);
    await entered.promise;
    const installing = storage.install(next.manifest, next.files);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(backing.caches.has(nextCache)).toBe(false);
    expect(backing.caches.has(firstCache)).toBe(true);
    release.resolve();
    expect(await reading).toEqual(first.files.basemap?.slice(127, 137));
    await installing;
    expect(backing.caches.has(firstCache)).toBe(false);
  });

  it('publishes invalidations after successful pack commits and removals', async () => {
    const publish = vi.fn();
    const storage = new CachePackStorage(new FakeCacheStorage(), (step) => step(), {
      publish,
      subscribe: () => () => undefined,
    });
    const pack = await packFiles(1);
    await storage.install(pack.manifest, pack.files);
    expect(publish).toHaveBeenCalledTimes(1);
    await storage.remove(CITY);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('preserves concurrent city installs across two tabs sharing the index lock', async () => {
    const backing = new FakeCacheStorage();
    let queue: Promise<unknown> = Promise.resolve();
    const lock: IndexLock = (step) => {
      const run = queue.then(step, step);
      queue = run.catch(() => undefined);
      return run;
    };
    const first = new CachePackStorage(backing, lock);
    const second = new CachePackStorage(backing, lock);
    const a = await packFiles(1);
    const b = await packFiles(1);
    b.manifest.city = 'another-city';
    const entered = deferred<void>();
    const release = deferred<void>();
    backing.faults.before = async (key) => {
      if (key.endsWith('dataset.json') && key.includes(a.manifest.installId)) {
        entered.resolve();
        await release.promise;
      }
    };
    const installingA = first.install(a.manifest, a.files);
    await entered.promise;
    const installingB = second.install(b.manifest, b.files);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(
      backing.caches.has(`${INSTALL_CACHE_PREFIX}${b.manifest.city}:${b.manifest.installId}`),
    ).toBe(false);
    release.resolve();
    await Promise.all([installingA, installingB]);
    const cities = (await first.list()).map((pack) => pack.city).sort();
    expect(cities).toEqual(['another-city', CITY].sort());
  });

  it('refuses version three after version four is committed by another tab', async () => {
    const backing = new FakeCacheStorage();
    const newer = await packFiles(4);
    const older = await packFiles(3);
    await new CachePackStorage(backing).install(newer.manifest, newer.files);
    const tab = new CachePackStorage(backing);
    expect((await failure(tab.install(older.manifest, older.files))).kind).toBe('integrity');
    expect(await tab.list()).toEqual([newer.manifest]);
  });

  it('never touches the service worker caches', async () => {
    const backing = new FakeCacheStorage();
    await backing.open('ngsw:/:db:control');
    const storage = new CachePackStorage(backing);
    await storage.list();
    expect(await backing.keys()).toContain('ngsw:/:db:control');
    const v1 = await packFiles(1);
    await storage.install(v1.manifest, v1.files);
    expect(await backing.keys()).toEqual(
      expect.arrayContaining(['ngsw:/:db:control', INDEX_CACHE]),
    );
  });
});

describe('Filesystem specifics', () => {
  it('removes the next index when its commit rename fails', async () => {
    const fs = new FakeFilesystem();
    const storage = new FilesystemPackStorage(fs, fs.readRange);
    const first = await packFiles(1);
    await storage.install(first.manifest, first.files);
    fs.renameError = new Error('rename failed');
    const next = await packFiles(2);
    expect((await failure(storage.install(next.manifest, next.files))).kind).toBe('io');
    expect(fs.files.has('packs/index.next.json')).toBe(false);
    fs.renameError = null;
    expect(await storage.list()).toEqual([first.manifest]);
  });

  it('never promotes a next index that references missing install files', async () => {
    const fs = new FakeFilesystem();
    const missing = await packFiles(1);
    fs.files.set(
      'packs/index.next.json',
      toBase64(new TextEncoder().encode(JSON.stringify({ version: 1, packs: [missing.manifest] }))),
    );
    expect(await new FilesystemPackStorage(fs, fs.readRange).list()).toEqual([]);
    expect(fs.files.has('packs/index.json')).toBe(false);
    const good = await packFiles(2);
    fs.files.delete('packs/index.next.json');
    const storage = new FilesystemPackStorage(fs, fs.readRange);
    await storage.install(good.manifest, good.files);
    fs.files.set(
      'packs/index.next.json',
      toBase64(new TextEncoder().encode(JSON.stringify({ version: 1, packs: [missing.manifest] }))),
    );
    expect(await storage.list()).toEqual([good.manifest]);
  });

  it('keeps a basemap generation alive until its in-flight range read finishes', async () => {
    const fs = new FakeFilesystem();
    const entered = deferred<void>();
    const release = deferred<void>();
    const storage = new FilesystemPackStorage(fs, async (uri, offset, length) => {
      entered.resolve();
      await release.promise;
      return fs.readRange(uri, offset, length);
    });
    const first = await packFiles(1, true);
    const next = await packFiles(2, true);
    await storage.install(first.manifest, first.files);
    const reading = storage.readBasemap(CITY, 127, 10, first.manifest.installId);
    await entered.promise;
    const installing = storage.install(next.manifest, next.files);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(fs.installDirs()).not.toContain(`packs/${CITY}/${next.manifest.installId}`);
    expect(fs.installDirs()).toContain(`packs/${CITY}/${first.manifest.installId}`);
    release.resolve();
    expect(await reading).toEqual(first.files.basemap?.slice(127, 137));
    await installing;
    expect(fs.installDirs()).not.toContain(`packs/${CITY}/${first.manifest.installId}`);
  });

  it('evicts whole-file fallback buffers using a two-file LRU bound', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])));
    const reader = createRangeReader(fetchFn);
    await reader('file:///one', 0, 1);
    await reader('file:///two', 0, 1);
    await reader('file:///one', 0, 1);
    await reader('file:///three', 0, 1);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await reader('file:///two', 0, 1);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    reader.forget?.('file:///two');
    await reader('file:///two', 0, 1);
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it('releases whole-file buffers when their install is updated or removed', async () => {
    const fs = new FakeFilesystem();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])));
    const reader = createRangeReader(fetchFn);
    const storage = new FilesystemPackStorage(fs, reader);
    const first = await packFiles(1, true);
    const next = await packFiles(2, true);
    const firstUri = `file:///data/packs/${CITY}/${first.manifest.installId}/basemap.pmtiles`;
    const nextUri = `file:///data/packs/${CITY}/${next.manifest.installId}/basemap.pmtiles`;
    await storage.install(first.manifest, first.files);
    await storage.readBasemap(CITY, 0, 1);
    await storage.install(next.manifest, next.files);
    await reader(firstUri, 0, 1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await storage.readBasemap(CITY, 0, 1);
    await storage.remove(CITY);
    await reader(nextUri, 0, 1);
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it('releases obsolete whole-file buffers when refreshing the native index', async () => {
    const fs = new FakeFilesystem();
    const fetchFn = vi.fn<typeof fetch>(async () => new Response(new Uint8Array([1, 2, 3])));
    const reader = createRangeReader(fetchFn);
    const storage = new FilesystemPackStorage(fs, reader);
    const pack = await packFiles(1, true);
    await storage.install(pack.manifest, pack.files);
    await storage.readBasemap(CITY, 0, 1);
    await new FilesystemPackStorage(fs, fs.readRange).remove(CITY);
    await storage.list();
    await reader(`file:///data/packs/${CITY}/${pack.manifest.installId}/basemap.pmtiles`, 0, 1);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('swaps the index with a rename and falls back to the next index after a crash', async () => {
    const fs = new FakeFilesystem();
    const storage = new FilesystemPackStorage(fs, fs.readRange, Directory.Data);
    const v1 = await packFiles(1);
    await storage.install(v1.manifest, v1.files);
    expect(fs.renames).toBe(1);
    expect(fs.files.has('packs/index.json')).toBe(true);
    // A crash between removing the old index and the rename leaves only the next index.
    fs.files.set('packs/index.next.json', fs.files.get('packs/index.json') ?? '');
    fs.files.delete('packs/index.json');
    const again = new FilesystemPackStorage(fs, fs.readRange, Directory.Data);
    expect((await again.list()).map((m) => m.installId)).toEqual([v1.manifest.installId]);
  });

  it('treats the Capacitor 8 missing-file error as an empty index on the first install', async () => {
    const fs = new FakeFilesystem();
    // Capacitor Filesystem 8 on Android and iOS: code OS-PLUG-FILE-0008 and this message.
    fs.faults.readFail = (path) =>
      fs.files.has(path)
        ? null
        : Object.assign(
            new Error(
              `'readFile' failed because file at '/data/user/0/app/files/${path}' does not exist.`,
            ),
            { code: 'OS-PLUG-FILE-0008' },
          );
    const storage = new FilesystemPackStorage(fs, fs.readRange, Directory.Data);
    expect(await storage.list()).toEqual([]);
    const v1 = await packFiles(1);
    await storage.install(v1.manifest, v1.files);
    expect((await storage.list()).map((m) => m.installId)).toEqual([v1.manifest.installId]);
  });

  it('recognises missing files in every reported form and nothing else', () => {
    const missing = [
      Object.assign(new Error('x'), { code: 'OS-PLUG-FILE-0008' }),
      Object.assign(new Error('x'), { code: 'ENOENT' }),
      new Error("'readFile' failed because file at '/data/packs/index.json' does not exist."),
      new Error("'readFile' failed because file does not exist."),
      new Error('File does not exist'),
    ];
    for (const error of missing) expect(isMissingFile(error), error.message).toBe(true);
    for (const error of [
      new Error('index I/O failure'),
      Object.assign(new Error('Unable to do file operation, user denied permission request.'), {
        code: 'OS-PLUG-FILE-0007',
      }),
    ]) {
      expect(isMissingFile(error), error.message).toBe(false);
    }
  });

  it('maps native out-of-space messages to quota', () => {
    expect(isQuotaError(new Error('ENOSPC: no space left on device'))).toBe(true);
    expect(isQuotaError(new Error('Unable to write file: not enough space'))).toBe(true);
    expect(isQuotaError(new Error('File does not exist'))).toBe(false);
  });
});

describe('choosePackStorage', () => {
  const factories = {
    filesystem: () => new MemoryPackStorage(),
    cache: () => new MemoryPackStorage(),
  };

  it('uses Filesystem natively and Cache Storage in the browser', () => {
    const fsStorage = { kind: 'filesystem' } as PackStorage;
    const cacheStorage = { kind: 'cache-storage' } as PackStorage;
    const pick = { filesystem: () => fsStorage, cache: () => cacheStorage };
    expect(choosePackStorage(pick, true, true)).toBe(fsStorage);
    expect(choosePackStorage(pick, false, true)).toBe(cacheStorage);
    expect(choosePackStorage(factories, false, false).kind).toBe('memory');
  });
});
