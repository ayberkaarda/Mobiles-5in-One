import { Capacitor } from '@capacitor/core';

/** Size and SHA-256 (lower-case hex) of one stored file. */
export interface PackFileInfo {
  bytes: number;
  sha256: string;
}

/** What is known about an installed pack without reading it. */
export interface PackManifest {
  city: string;
  name: string;
  isSample: boolean;
  bbox: number[];
  centroid: number[];
  timezone: string;
  packVersion: number;
  lineCount: number;
  stopCount: number;
  dataset: PackFileInfo;
  /** The PMTiles basemap, or `null` when the city has no archive (or it could not be fetched). */
  basemap: PackFileInfo | null;
  installedAt: string;
  /** Unique per install; names the storage location of this generation of files. */
  installId: string;
}

export interface PackFiles {
  dataset: Uint8Array;
  basemap: Uint8Array | null;
}

export type PackStorageErrorKind = 'quota' | 'integrity' | 'io' | 'unsupported';

export class PackStorageError extends Error {
  constructor(
    readonly kind: PackStorageErrorKind,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'PackStorageError';
  }
}

export interface PackStorageEstimate {
  /** Bytes used by installed packs (from the manifests). */
  packs: number;
  /** Origin usage and quota from `navigator.storage.estimate()`, when the platform tells. */
  usage: number | null;
  quota: number | null;
}

/**
 * Where offline packs live: Capacitor Filesystem in the native shells, Cache Storage in the
 * PWA. Every implementation installs atomically: the new files are written to a fresh location,
 * read back and checked against the manifest (length and SHA-256), and only then does one
 * index write switch the city to them. A failure at any step leaves the previous install of the
 * city untouched and removes the partial files.
 */
export interface PackStorage {
  readonly kind: 'filesystem' | 'cache-storage' | 'memory' | 'none';
  /** Manifests of the committed installs; also removes leftovers of interrupted installs. */
  list(): Promise<PackManifest[]>;
  /** The dataset bytes of the committed install, or `null`. */
  readDataset(city: string): Promise<Uint8Array | null>;
  /** `length` bytes of the basemap from `offset` (fewer at the end), or `null`. */
  readBasemap(city: string, offset: number, length: number): Promise<Uint8Array | null>;
  install(manifest: PackManifest, files: PackFiles): Promise<void>;
  remove(city: string): Promise<void>;
  estimate(): Promise<PackStorageEstimate>;
}

/** Lower-case hex SHA-256 through Web Crypto. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new PackStorageError('unsupported', 'Web Crypto is not available');
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const digest = await subtle.digest('SHA-256', copy.buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function fileInfo(bytes: Uint8Array): Promise<PackFileInfo> {
  return { bytes: bytes.length, sha256: await sha256Hex(bytes) };
}

/** Throws `integrity` unless `bytes` is exactly the file described by `info`. */
export async function verifyFile(
  label: string,
  bytes: Uint8Array | null,
  info: PackFileInfo,
): Promise<void> {
  if (!bytes || bytes.length !== info.bytes) {
    throw new PackStorageError('integrity', `${label}: length differs after writing`);
  }
  if ((await sha256Hex(bytes)) !== info.sha256) {
    throw new PackStorageError('integrity', `${label}: hash differs after writing`);
  }
}

/** True for the storage-full errors of browsers and the native file APIs. */
export function isQuotaError(error: unknown): boolean {
  if (error instanceof PackStorageError) return error.kind === 'quota';
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'QuotaExceededError') return true;
  const message = String((error as { message?: unknown } | null)?.message ?? error);
  return /quota|no space|ENOSPC|not enough space|disk full|storage full/i.test(message);
}

export function asStorageError(error: unknown, what: string): PackStorageError {
  if (error instanceof PackStorageError) return error;
  return new PackStorageError(isQuotaError(error) ? 'quota' : 'io', what, error);
}

export function newInstallId(): string {
  const crypto = globalThis.crypto;
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export const CITY_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isManifest(v: unknown): v is PackManifest {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Record<string, unknown>;
  const info = (x: unknown) =>
    typeof x === 'object' &&
    x !== null &&
    typeof (x as PackFileInfo).bytes === 'number' &&
    typeof (x as PackFileInfo).sha256 === 'string';
  return (
    typeof m['city'] === 'string' &&
    CITY_SLUG.test(m['city']) &&
    typeof m['name'] === 'string' &&
    typeof m['packVersion'] === 'number' &&
    typeof m['installId'] === 'string' &&
    /^[A-Za-z0-9-]{8,64}$/.test(m['installId']) &&
    info(m['dataset']) &&
    (m['basemap'] === null || info(m['basemap'])) &&
    Array.isArray(m['bbox']) &&
    Array.isArray(m['centroid'])
  );
}

export async function originEstimate(): Promise<{ usage: number | null; quota: number | null }> {
  try {
    const estimate = await globalThis.navigator?.storage?.estimate?.();
    return { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
  } catch {
    return { usage: null, quota: null };
  }
}

export const packBytesOf = (manifests: readonly PackManifest[]) =>
  manifests.reduce((sum, m) => sum + m.dataset.bytes + (m.basemap?.bytes ?? 0), 0);

/**
 * In-memory storage: used where neither Filesystem nor Cache Storage exists (tests, very old
 * browsers). It follows the same verify-then-swap rule; packs do not survive a reload.
 */
export class MemoryPackStorage implements PackStorage {
  readonly kind: 'memory' | 'none' = 'memory';
  private readonly installs = new Map<string, { manifest: PackManifest; files: PackFiles }>();

  async list(): Promise<PackManifest[]> {
    return [...this.installs.values()].map((i) => i.manifest);
  }

  async readDataset(city: string): Promise<Uint8Array | null> {
    return this.installs.get(city)?.files.dataset ?? null;
  }

  async readBasemap(city: string, offset: number, length: number): Promise<Uint8Array | null> {
    const basemap = this.installs.get(city)?.files.basemap;
    return basemap ? basemap.slice(offset, offset + length) : null;
  }

  async install(manifest: PackManifest, files: PackFiles): Promise<void> {
    const staged: PackFiles = {
      dataset: files.dataset.slice(),
      basemap: files.basemap ? files.basemap.slice() : null,
    };
    await verifyFile('dataset', staged.dataset, manifest.dataset);
    if (manifest.basemap) await verifyFile('basemap', staged.basemap, manifest.basemap);
    this.installs.set(manifest.city, { manifest, files: staged });
  }

  async remove(city: string): Promise<void> {
    this.installs.delete(city);
  }

  async estimate(): Promise<PackStorageEstimate> {
    return { packs: packBytesOf(await this.list()), usage: null, quota: null };
  }
}

export interface PackStorageFactories {
  filesystem: () => PackStorage;
  cache: () => PackStorage;
}

/** Native shells: Filesystem. Browsers with Cache Storage: Cache Storage. Else memory only. */
export function choosePackStorage(
  factories: PackStorageFactories,
  native = Capacitor.isNativePlatform(),
  hasCaches = typeof globalThis.caches !== 'undefined',
): PackStorage {
  if (native) return factories.filesystem();
  if (hasCaches) return factories.cache();
  return new MemoryPackStorage();
}
