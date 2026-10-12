import { Directory } from '@capacitor/filesystem';
import type { CacheLike, CacheStorageLike } from '../packs/cache-pack-storage';
import { fromBase64, type FilesystemLike } from '../packs/filesystem-pack-storage';

/** Decides per write whether it fails (the returned error is thrown) or is corrupted. */
export interface WriteFaults {
  fail?: (key: string) => Error | null;
  corrupt?: (key: string) => boolean;
}

export function quotaError(): Error {
  const error = new Error('The quota has been exceeded.');
  error.name = 'QuotaExceededError';
  return error;
}

function flipLastByte(bytes: Uint8Array): Uint8Array {
  const copy = bytes.slice();
  if (copy.length > 0) copy[copy.length - 1] = (copy[copy.length - 1] ?? 0) ^ 0xff;
  return copy;
}

/** Cache Storage in memory with injectable write faults. */
export class FakeCacheStorage implements CacheStorageLike {
  readonly caches = new Map<string, Map<string, { bytes: Uint8Array; type: string }>>();
  faults: WriteFaults = {};

  async open(name: string): Promise<CacheLike> {
    let entries = this.caches.get(name);
    if (!entries) this.caches.set(name, (entries = new Map()));
    const store = entries;
    return {
      put: async (request, response) => {
        const error = this.faults.fail?.(request);
        if (error) throw error;
        let bytes: Uint8Array = new Uint8Array(await response.arrayBuffer());
        if (this.faults.corrupt?.(request)) bytes = flipLastByte(bytes);
        store.set(request, { bytes, type: response.headers.get('Content-Type') ?? '' });
      },
      match: async (request) => {
        const entry = store.get(request);
        if (!entry) return undefined;
        const body = new Uint8Array(entry.bytes.length);
        body.set(entry.bytes);
        return new Response(body, { headers: { 'Content-Type': entry.type } });
      },
    };
  }

  async delete(name: string): Promise<boolean> {
    return this.caches.delete(name);
  }

  async keys(): Promise<string[]> {
    return [...this.caches.keys()];
  }
}

/** `@capacitor/filesystem` in memory (paths to base64 data) with injectable write faults. */
export class FakeFilesystem implements FilesystemLike {
  readonly files = new Map<string, string>();
  faults: WriteFaults = {};
  renames = 0;

  async writeFile(options: { path: string; data: string; directory: Directory }) {
    const error = this.faults.fail?.(options.path);
    if (error) throw error;
    let data = options.data;
    if (this.faults.corrupt?.(options.path)) {
      const bytes = flipLastByte(fromBase64(data));
      data = btoa(String.fromCharCode(...bytes));
    }
    this.files.set(options.path, data);
    return { uri: `file:///data/${options.path}` };
  }

  async readFile(options: { path: string }) {
    const data = this.files.get(options.path);
    if (data === undefined) throw new Error('File does not exist');
    return { data };
  }

  async rename(options: { from: string; to: string }) {
    const data = this.files.get(options.from);
    if (data === undefined) throw new Error('File does not exist');
    this.renames++;
    this.files.delete(options.from);
    this.files.set(options.to, data);
  }

  async rmdir(options: { path: string }) {
    for (const path of [...this.files.keys()]) {
      if (path.startsWith(options.path + '/')) this.files.delete(path);
    }
  }

  async readdir(options: { path: string }) {
    const prefix = options.path + '/';
    const names = new Map<string, 'file' | 'directory'>();
    for (const path of this.files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      const [head = '', ...tail] = rest.split('/');
      names.set(head, tail.length > 0 ? 'directory' : 'file');
    }
    if (names.size === 0) throw new Error('Directory does not exist');
    return { files: [...names].map(([name, type]) => ({ name, type })) };
  }

  async deleteFile(options: { path: string }) {
    this.files.delete(options.path);
  }

  async getUri(options: { path: string }) {
    return { uri: `file:///data/${options.path}` };
  }

  /** The range reader the storage gets in tests: slices the stored file. */
  readonly readRange = async (uri: string, offset: number, length: number) => {
    const path = uri.replace('file:///data/', '');
    const data = this.files.get(path);
    if (data === undefined) throw new Error('File does not exist');
    return fromBase64(data).slice(offset, offset + length);
  };

  /** Paths of the install directories present, like `packs/<city>/<installId>`. */
  installDirs(): string[] {
    const dirs = new Set<string>();
    for (const path of this.files.keys()) {
      const parts = path.split('/');
      if (parts[0] === 'packs' && parts.length === 4) dirs.add(parts.slice(0, 3).join('/'));
    }
    return [...dirs].sort();
  }
}

/** A minimal valid PMTiles v3 header (127 bytes) followed by `extra` payload bytes. */
export function fakePmtiles(extra = 64): Uint8Array {
  const bytes = new Uint8Array(127 + extra);
  bytes.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 3]);
  for (let i = 127; i < bytes.length; i++) bytes[i] = i % 251;
  return bytes;
}
