import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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

describe('connection loss while a connection is checked out', () => {
  it('keeps the process alive, rejects the query and recovers on a new connection', async () => {
    const script = fileURLToPath(new URL('./fixtures/connection-loss-child.mjs', import.meta.url));
    const child = spawn(process.execPath, [script, databaseUrl], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const events: ChildEvent[] = [];
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
    try {
      createInterface({ input: child.stdout }).on('line', (line) => {
        const event = JSON.parse(line) as ChildEvent;
        events.push(event);
        if (event.event === 'pid') {
          // Only ever the connection this test's own child opened against its own database.
          void admin.query('select pg_terminate_backend($1)', [event.pid]);
        }
      });
      const [code, signal] = await once(child, 'exit');
      expect({ code, signal, stderr }).toEqual({ code: 0, signal: null, stderr: '' });
    } finally {
      child.kill();
      await admin.end();
    }
    const names = events.map((entry) => entry.event);
    expect(names).toContain('client-error-logged');
    expect(names).not.toContain('unexpected-success');
    const rejected = events.find((entry) => entry.event === 'rejected');
    expect(rejected).toBeDefined();
    // Only the error class is reported: no SQL text or connection details reach the log.
    expect(JSON.stringify(events)).not.toContain(databaseUrl);
    expect(events.at(-1)).toEqual({ event: 'recovered', ok: 1 });
  });
});
