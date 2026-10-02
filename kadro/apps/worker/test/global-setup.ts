import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

import pg from 'pg';
import type { TestProject } from 'vitest/node';

const run = promisify(execFile);

/** Same PostgreSQL major and PostGIS image as the database package tests. */
export const TEST_IMAGE = 'postgis/postgis:16-3.5-alpine';
const READY_TIMEOUT_MS = 90_000;

declare module 'vitest' {
  export interface ProvidedContext {
    /** Superuser URL of the disposable test server's maintenance database. */
    adminDatabaseUrl: string;
  }
}

async function docker(args: readonly string[]): Promise<string> {
  const { stdout } = await run('docker', [...args], { windowsHide: true });
  return stdout.trim();
}

async function waitForServer(url: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError: unknown;
  // The image restarts its server once after init; two consecutive successes skip that window.
  let successes = 0;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      await client.query('select 1');
      successes += 1;
      if (successes >= 2) {
        return;
      }
    } catch (error) {
      successes = 0;
      lastError = error;
    } finally {
      await client.end().catch(() => undefined);
    }
    await delay(500);
  }
  throw new Error('test PostgreSQL container did not become ready in time', { cause: lastError });
}

/**
 * Runs a throw-away PostGIS container (tmpfs data directory, random loopback port, removed on
 * teardown). It never touches the docker compose project or its volumes.
 */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  try {
    await docker(['info', '--format', '{{.ServerVersion}}']);
  } catch (error) {
    throw new Error(
      'Docker daemon is not reachable. The worker tests run pg-boss against a real PostgreSQL + PostGIS server; start Docker and retry.',
      { cause: error },
    );
  }

  const name = `kadro-worker-test-${randomBytes(6).toString('hex')}`;
  const user = `worker_admin_${randomBytes(4).toString('hex')}`;
  const password = randomBytes(18).toString('base64url');
  await docker([
    'run',
    '--detach',
    '--rm',
    '--name',
    name,
    '--label',
    'kadro.purpose=apps-worker-tests',
    '--tmpfs',
    '/var/lib/postgresql/data',
    '--env',
    `POSTGRES_USER=${user}`,
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    '--env',
    `POSTGRES_DB=${user}`,
    '--publish',
    '127.0.0.1::5432',
    TEST_IMAGE,
    '-c',
    'max_connections=400',
  ]);

  const teardown = async (): Promise<void> => {
    await docker(['rm', '--force', '--volumes', name]).catch(() => undefined);
  };

  try {
    const mapping = await docker(['port', name, '5432/tcp']);
    const port = /:(\d+)\s*$/m.exec(mapping.split('\n')[0] ?? '')?.[1];
    if (port === undefined) {
      throw new Error(`unexpected docker port output: ${mapping}`);
    }
    const url = `postgres://${user}:${password}@127.0.0.1:${port}/${user}`;
    await waitForServer(url);
    project.provide('adminDatabaseUrl', url);
  } catch (error) {
    await teardown();
    throw error;
  }

  return teardown;
}
