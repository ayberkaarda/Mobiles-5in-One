import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createDbClient } from '../src/client.js';

import { createEmptyDatabase } from './support.js';

interface ChildEvent {
  readonly event: string;
  readonly [key: string]: unknown;
}

let databaseUrl: string;
let drop: () => Promise<void>;

beforeAll(async () => {
  const database = await createEmptyDatabase('kadro_connloss');
  databaseUrl = database.url;
  drop = database.drop;
});

afterAll(async () => {
  await drop();
});

const CHILD_TIMEOUT_MS = 30_000;

interface ChildRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly events: ChildEvent[];
  readonly terminated: boolean[];
}

/**
 * Runs the child against the test database. Once the child reports its backend pid and that
 * backend is observed executing `pg_sleep`, the connection is terminated from a second
 * connection of this test.
 */
async function runChild(): Promise<ChildRun> {
  const script = fileURLToPath(new URL('./fixtures/connection-loss-child.mjs', import.meta.url));
  // The child loads TypeScript sources directly; the flag keeps this working on every supported
  // Node 22.x (newer releases enable type stripping by default).
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', script, databaseUrl],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const events: ChildEvent[] = [];
  const terminated: boolean[] = [];
  let stderr = '';
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve({ code, signal }));
    },
  );
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const timer = setTimeout(() => child.kill(), CHILD_TIMEOUT_MS);
  const admin = new pg.Client({ connectionString: databaseUrl });
  const pending: Promise<void>[] = [];
  try {
    await admin.connect();
    const terminate = async (pid: unknown): Promise<void> => {
      const deadline = Date.now() + 15_000;
      for (;;) {
        const active = await admin.query(
          `select 1 from pg_stat_activity
            where pid = $1 and datname = current_database() and state = 'active'
              and query like '%pg_sleep%'`,
          [pid],
        );
        if (active.rowCount === 1) {
          break;
        }
        if (Date.now() > deadline) {
          throw new Error('child backend never started pg_sleep');
        }
        await delay(25);
      }
      // Only ever the connection this test's own child opened against its own database.
      const result = await admin.query('select pg_terminate_backend($1) as ok', [pid]);
      terminated.push(result.rows[0].ok === true);
    };
    createInterface({ input: child.stdout }).on('line', (line) => {
      const event = JSON.parse(line) as ChildEvent;
      events.push(event);
      if (event.event === 'pid') {
        pending.push(terminate(event.pid));
      }
    });
    const { code, signal } = await closed;
    await Promise.all(pending);
    return { code, signal, stderr, events, terminated };
  } finally {
    clearTimeout(timer);
    child.kill();
    await admin.end().catch(() => undefined);
  }
}

describe('connection loss while a connection is checked out', () => {
  it('keeps the process alive, rejects the query and recovers on a new connection', async () => {
    const run = await runChild();
    expect({ code: run.code, signal: run.signal, stderr: run.stderr }).toEqual({
      code: 0,
      signal: null,
      stderr: '',
    });
    expect(run.terminated).toEqual([true]);
    const names = run.events.map((entry) => entry.event);
    expect(names.filter((name) => name === 'client-error-logged')).toHaveLength(1);
    expect(names).not.toContain('unexpected-success');
    expect(names).toContain('rejected');
    // Only the error class is reported: no SQL text or connection details reach the log.
    expect(JSON.stringify(run.events)).not.toContain(databaseUrl);
    // The broken connection left the pool: only the replacement is counted, and it is idle.
    expect(run.events.at(-1)).toEqual({ event: 'recovered', ok: 1, total: 1, idle: 1 });
  });

  it('reports a failed idle connection exactly once', async () => {
    const onClientError = vi.fn();
    const client = createDbClient({
      connectionString: databaseUrl,
      maxConnections: 1,
      onClientError,
    });
    const admin = new pg.Client({ connectionString: databaseUrl });
    try {
      await admin.connect();
      const pidResult = await client.pool.query<{ pid: number }>('select pg_backend_pid() as pid');
      const pid = pidResult.rows[0]?.pid;
      const result = await admin.query('select pg_terminate_backend($1) as ok', [pid]);
      expect(result.rows[0].ok).toBe(true);
      await vi.waitFor(() => expect(onClientError).toHaveBeenCalled());
      await delay(200);
      expect(onClientError).toHaveBeenCalledTimes(1);
    } finally {
      await admin.end();
      await client.close();
    }
  });
});
