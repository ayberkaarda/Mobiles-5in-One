import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
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
  verifyFile,
} from './pack-storage';

interface PathOptions {
  path: string;
  directory: Directory;
}

/** The part of `@capacitor/filesystem` the storage uses; tests pass a fake. */
export interface FilesystemLike {
  writeFile(options: PathOptions & { data: string; recursive?: boolean }): Promise<unknown>;
  readFile(options: PathOptions): Promise<{ data: string | Blob }>;
  rename(options: { from: string; to: string; directory: Directory }): Promise<void>;
  rmdir(options: PathOptions & { recursive?: boolean }): Promise<void>;
  readdir(options: PathOptions): Promise<{ files: { name: string; type: 'file' | 'directory' }[] }>;
  deleteFile(options: PathOptions): Promise<void>;
  getUri(options: PathOptions): Promise<{ uri: string }>;
}

/** Reads `length` bytes from `offset` of a file given by its native URI. */
export type RangeReader = (uri: string, offset: number, length: number) => Promise<Uint8Array>;

const ROOT = 'packs';
const INDEX = `${ROOT}/index.json`;
const INDEX_NEXT = `${ROOT}/index.next.json`;

interface PackIndexFile {
  version: 1;
  packs: PackManifest[];
}

const installDir = (m: Pick<PackManifest, 'city' | 'installId'>) =>
  `${ROOT}/${m.city}/${m.installId}`;

/**
 * Native storage under the app's data directory (`Directory.Data`, not backed up as user
 * documents). Files of one install live in `packs/<city>/<installId>/`; `packs/index.json`
 * lists the committed manifests. Installing writes and reads back the new directory, then
 * writes `index.next.json` and renames it over `index.json` (the swap); a crash between the two
 * leaves `index.next.json` complete, and `list` falls back to it. Directories no index entry
 * points to are removed by `list`.
 */
export class FilesystemPackStorage implements PackStorage {
  readonly kind = 'filesystem' as const;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly directory: Directory;

  constructor(
    private readonly fs: FilesystemLike,
    private readonly readRange: RangeReader = fetchRange,
    directory: Directory = Directory.Data,
  ) {
    this.directory = directory;
  }

  async list(): Promise<PackManifest[]> {
    return this.serial(async () => {
      const index = await this.readIndex();
      await this.collectGarbage(index);
      return index.packs;
    });
  }

  async readDataset(city: string): Promise<Uint8Array | null> {
    const manifest = await this.committed(city);
    if (!manifest) return null;
    try {
      return await this.readBytes(`${installDir(manifest)}/dataset.json`);
    } catch {
      return null;
    }
  }

  async readBasemap(city: string, offset: number, length: number): Promise<Uint8Array | null> {
    const manifest = await this.committed(city);
    if (!manifest?.basemap) return null;
    const { uri } = await this.fs.getUri({
      path: `${installDir(manifest)}/basemap.pmtiles`,
      directory: this.directory,
    });
    const end = Math.min(offset + length, manifest.basemap.bytes);
    return this.readRange(uri, offset, Math.max(0, end - offset));
  }

  async install(manifest: PackManifest, files: PackFiles): Promise<void> {
    if (manifest.basemap && !files.basemap) {
      throw new PackStorageError('integrity', 'basemap missing');
    }
    const dir = installDir(manifest);
    let previous: PackManifest | undefined;
    try {
      await this.writeBytes(`${dir}/dataset.json`, files.dataset);
      if (manifest.basemap && files.basemap) {
        await this.writeBytes(`${dir}/basemap.pmtiles`, files.basemap);
      }
      await verifyFile('dataset', await this.readBytes(`${dir}/dataset.json`), manifest.dataset);
      if (manifest.basemap) {
        await verifyFile(
          'basemap',
          await this.readBytes(`${dir}/basemap.pmtiles`),
          manifest.basemap,
        );
      }
      await this.serial(async () => {
        const index = await this.readIndex();
        previous = index.packs.find((p) => p.city === manifest.city);
        const packs = index.packs.filter((p) => p.city !== manifest.city);
        packs.push(manifest);
        await this.writeIndex({ version: 1, packs });
      });
    } catch (error) {
      await this.fs
        .rmdir({ path: dir, directory: this.directory, recursive: true })
        .catch(() => undefined);
      throw asStorageError(error, 'install failed');
    }
    if (previous && previous.installId !== manifest.installId) {
      await this.fs
        .rmdir({ path: installDir(previous), directory: this.directory, recursive: true })
        .catch(() => undefined);
    }
  }

  async remove(city: string): Promise<void> {
    let removed: PackManifest | undefined;
    await this.serial(async () => {
      const index = await this.readIndex();
      removed = index.packs.find((p) => p.city === city);
      if (!removed) return;
      await this.writeIndex({ version: 1, packs: index.packs.filter((p) => p.city !== city) });
    });
    if (removed) {
      await this.fs
        .rmdir({ path: `${ROOT}/${city}`, directory: this.directory, recursive: true })
        .catch(() => undefined);
    }
  }

  async estimate(): Promise<PackStorageEstimate> {
    const packs = packBytesOf((await this.serial(() => this.readIndex())).packs);
    return { packs, ...(await originEstimate()) };
  }

  private async committed(city: string): Promise<PackManifest | undefined> {
    return (await this.serial(() => this.readIndex())).packs.find((p) => p.city === city);
  }

  private async readIndex(): Promise<PackIndexFile> {
    for (const path of [INDEX, INDEX_NEXT]) {
      try {
        const text = new TextDecoder().decode(await this.readBytes(path));
        const parsed = JSON.parse(text) as Partial<PackIndexFile>;
        if (Array.isArray(parsed.packs)) {
          return { version: 1, packs: parsed.packs.filter(isManifest) };
        }
      } catch {
        // Missing or unreadable: try the next generation.
      }
    }
    return { version: 1, packs: [] };
  }

  private async writeIndex(index: PackIndexFile): Promise<void> {
    await this.writeBytes(INDEX_NEXT, new TextEncoder().encode(JSON.stringify(index)));
    await this.fs.rename({ from: INDEX_NEXT, to: INDEX, directory: this.directory });
  }

  private async collectGarbage(index: PackIndexFile): Promise<void> {
    const live = new Set(index.packs.map(installDir));
    try {
      const cities = await this.fs.readdir({ path: ROOT, directory: this.directory });
      for (const city of cities.files) {
        if (city.type !== 'directory') continue;
        const installs = await this.fs.readdir({
          path: `${ROOT}/${city.name}`,
          directory: this.directory,
        });
        for (const install of installs.files) {
          const path = `${ROOT}/${city.name}/${install.name}`;
          if (install.type === 'directory' && !live.has(path)) {
            await this.fs.rmdir({ path, directory: this.directory, recursive: true });
          }
        }
      }
    } catch {
      // Nothing stored yet, or cleanup failed; the next list tries again.
    }
  }

  private async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    await this.fs.writeFile({
      path,
      data: toBase64(bytes),
      directory: this.directory,
      recursive: true,
    });
  }

  private async readBytes(path: string): Promise<Uint8Array> {
    const { data } = await this.fs.readFile({ path, directory: this.directory });
    if (typeof data === 'string') return fromBase64(data);
    return new Uint8Array(await data.arrayBuffer());
  }

  private serial<T>(step: () => Promise<T>): Promise<T> {
    const run = this.queue.then(step, step);
    this.queue = run.catch(() => undefined);
    return run;
  }
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const wholeFiles = new Map<string, Promise<Uint8Array>>();

/**
 * Range read through the WebView's local file URL. Servers that ignore `Range` answer 200 with
 * the whole file, which is then kept in memory for the next reads of the same file.
 */
export async function fetchRange(uri: string, offset: number, length: number): Promise<Uint8Array> {
  if (length <= 0) return new Uint8Array(0);
  const url = Capacitor.convertFileSrc(uri);
  const cached = wholeFiles.get(url);
  if (!cached) {
    const response = await fetch(url, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
    });
    if (response.status === 206) return new Uint8Array(await response.arrayBuffer());
    if (!response.ok) throw new PackStorageError('io', `basemap read failed (${response.status})`);
    const whole = response.arrayBuffer().then((b) => new Uint8Array(b));
    wholeFiles.set(url, whole);
    whole.catch(() => wholeFiles.delete(url));
    return (await whole).slice(offset, offset + length);
  }
  return (await cached).slice(offset, offset + length);
}

export function nativeFilesystem(): FilesystemLike {
  return Filesystem as unknown as FilesystemLike;
}
