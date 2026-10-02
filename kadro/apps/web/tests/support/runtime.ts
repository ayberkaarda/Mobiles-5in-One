import { type WebEnv } from '@kadro/config';
import { type Database } from '@kadro/db';

import { createLogger } from '../../lib/server/logging';
import {
  createServerRuntime,
  installServerRuntime,
  type ServerRuntime,
} from '../../lib/server/runtime';
import { testEnv } from './env';

export interface TestRuntime {
  readonly runtime: ServerRuntime;
  readonly env: WebEnv;
  /** Raw JSON lines written by the logger. */
  readonly logLines: string[];
  /** Delays requested by the progressive auth delay (ms); nothing actually sleeps. */
  readonly sleeps: number[];
  /** Moves the controlled clock forward. */
  advance(ms: number): void;
  setNow(date: Date): void;
}

export interface TestRuntimeOptions {
  /** Database for DB-backed suites; unit suites get a pool that is never used. */
  readonly db?: Database;
  readonly env?: Readonly<Record<string, string>>;
  readonly logLevel?: 'info' | 'debug';
  readonly now?: Date;
}

/** Builds a runtime with captured logs, a controlled clock and no real sleeping, and installs it. */
export async function installTestRuntime(options: TestRuntimeOptions = {}): Promise<TestRuntime> {
  const env = testEnv(options.env);
  const logLines: string[] = [];
  const sleeps: number[] = [];
  let now = options.now ?? new Date();
  const runtime = await createServerRuntime(env, {
    ...(options.db === undefined ? {} : { db: options.db }),
    logger: createLogger({
      level: options.logLevel ?? 'info',
      destination: {
        write(line: string) {
          logLines.push(line);
        },
      },
    }),
    now: () => now,
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
  });
  installServerRuntime(runtime);
  return {
    runtime,
    env,
    logLines,
    sleeps,
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
    setNow(date) {
      now = date;
    },
  };
}
