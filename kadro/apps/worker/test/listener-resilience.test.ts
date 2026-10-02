import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { safeLog } from '../src/safe-log.js';
import {
  type FakeProvider,
  type TestDatabase,
  type TestWorker,
  createTestDatabase,
  startFakeProvider,
  startTestWorker,
} from './support.js';

let database: TestDatabase;
let provider: FakeProvider;
let worker: TestWorker;
let attempts = 0;
let broken = false;

/** A logger that throws on every call once `broken` is set, as a broken log transport would. */
const throwingLogger = new Proxy(
  {},
  {
    get: () => () => {
      if (broken) {
        attempts += 1;
        throw new Error('log transport down');
      }
    },
  },
) as never;

beforeAll(async () => {
  database = await createTestDatabase('worker_listener_resilience');
  provider = await startFakeProvider();
  worker = await startTestWorker(database, provider, { extra: { logger: throwingLogger } });
  broken = true;
});

afterAll(async () => {
  broken = false;
  await worker.runtime.stop();
  await provider.close();
  await database.dispose();
});

describe('pg-boss event listeners', () => {
  it('survive a logger that throws', () => {
    const before = attempts;
    expect(() => worker.runtime.boss.emit('error', new Error('boss failure'))).not.toThrow();
    expect(() =>
      worker.runtime.boss.emit('warning', { message: 'slow', data: {} } as never),
    ).not.toThrow();
    expect(attempts).toBe(before + 2);
  });
});

describe('safeLog', () => {
  it('swallows a throwing log call and returns normally', () => {
    expect(() =>
      safeLog(() => {
        throw new Error('log transport down');
      }),
    ).not.toThrow();
  });
});
