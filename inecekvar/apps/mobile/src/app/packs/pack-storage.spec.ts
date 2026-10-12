import { Directory } from '@capacitor/filesystem';
import { packBody, samplePackData } from '../testing/catalog.fixtures';
import { FakeCacheStorage, FakeFilesystem, fakePmtiles, quotaError } from '../testing/pack.fakes';
import { CachePackStorage, INDEX_CACHE, INSTALL_CACHE_PREFIX } from './cache-pack-storage';
import { FilesystemPackStorage } from './filesystem-pack-storage';
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
  };
}

describe.each([
  ['Cache Storage', cacheHarness],
  ['Filesystem', filesystemHarness],
])('%s pack storage', (_name, harness) => {
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
