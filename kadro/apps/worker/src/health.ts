import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Health and readiness signal. The worker has no HTTP listener; it writes a small JSON status file
 * that the container health check (`node dist/healthcheck.js`) reads. `ready` is written only after
 * the queues exist and the handlers are registered, and refreshed by a periodic database probe.
 */

export const HEALTH_STATUSES = ['starting', 'ready', 'unhealthy', 'stopping', 'stopped'] as const;
export type HealthStatus = (typeof HEALTH_STATUSES)[number];

export interface HealthSnapshot {
  readonly status: HealthStatus;
  readonly pid: number;
  readonly updatedAt: string;
}

/** A `ready` snapshot older than this is reported unhealthy (the probe runs every 30 s). */
export const HEALTH_MAX_AGE_MS = 90_000;

export function defaultHealthFile(): string {
  return join(tmpdir(), 'kadro-worker', 'health.json');
}

export class HealthReporter {
  #status: HealthStatus = 'starting';

  constructor(
    readonly file: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get status(): HealthStatus {
    return this.#status;
  }

  async set(status: HealthStatus): Promise<void> {
    this.#status = status;
    const snapshot: HealthSnapshot = {
      status,
      pid: process.pid,
      updatedAt: this.now().toISOString(),
    };
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- status file path fixed at construction
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- sibling of the fixed status file
    await writeFile(temporary, JSON.stringify(snapshot), 'utf8');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- sibling of the fixed status file
    await rename(temporary, this.file);
  }

  async clear(): Promise<void> {
    this.#status = 'stopped';
    await rm(this.file, { force: true });
  }
}

export type HealthVerdict =
  { readonly healthy: true } | { readonly healthy: false; readonly reason: string };

export async function readHealth(file: string, now: Date = new Date()): Promise<HealthVerdict> {
  let snapshot: Partial<HealthSnapshot>;
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the worker's own status file
    snapshot = JSON.parse(await readFile(file, 'utf8')) as Partial<HealthSnapshot>;
  } catch {
    return { healthy: false, reason: 'no status file' };
  }
  if (snapshot.status !== 'ready') {
    return { healthy: false, reason: `status ${String(snapshot.status)}` };
  }
  const updatedAt = Date.parse(String(snapshot.updatedAt));
  if (!Number.isFinite(updatedAt) || now.getTime() - updatedAt > HEALTH_MAX_AGE_MS) {
    return { healthy: false, reason: 'status is stale' };
  }
  return { healthy: true };
}
