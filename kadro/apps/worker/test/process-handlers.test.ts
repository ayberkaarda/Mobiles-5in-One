import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  FATAL_SHUTDOWN_GRACE_MS,
  installProcessHandlers,
  sanitizeStack,
} from '../src/process-handlers.js';

interface ChildRun {
  readonly code: number | null;
  readonly stdout: string;
  readonly records: Record<string, unknown>[];
}

const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = fileURLToPath(new URL('./fixtures/process-handlers-child.mjs', import.meta.url));

async function runChild(mode: string): Promise<ChildRun> {
  const child = spawn(process.execPath, ['--import', 'tsx', SCRIPT, mode], {
    cwd: WORKER_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.resume();
  const timer = setTimeout(() => child.kill(), 20_000);
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  clearTimeout(timer);
  const records = stdout
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { code, stdout, records };
}

const fatal = (run: ChildRun) => run.records.filter((record) => record.level === 60);

describe('process-level handlers', () => {
  it.each([
    ['throw', 'uncaughtException'],
    ['reject', 'unhandledRejection'],
  ])('%s: logs fatal, runs shutdown and exits non-zero', async (mode, kind) => {
    const run = await runChild(mode);
    expect(run.code).not.toBe(0);
    expect(run.code).not.toBeNull();
    expect(fatal(run)).toHaveLength(1);
    expect(fatal(run)[0]).toMatchObject({ kind, errorType: 'Error', service: 'kadro-worker' });
    expect(run.stdout).toContain('shutdown-called');
    // Error messages can carry personal data; only the error type is logged.
    expect(run.stdout).not.toContain('ayse@example.com');
    // The crash location survives: function and file:line:column, relative to the worker.
    const stack = fatal(run)[0]?.stack as string[];
    expect(stack.length).toBeGreaterThan(0);
    expect(stack.some((frame) => /process-handlers-child\.mjs:\d+:\d+/.test(frame))).toBe(true);
    expect(stack.join('\n')).not.toContain(WORKER_DIR.replaceAll('\\', '/'));
  });

  it('exits after the grace period when shutdown hangs', async () => {
    const run = await runChild('throw-hung-shutdown');
    expect(run.code).toBe(1);
    expect(fatal(run)).toHaveLength(1);
  });

  it('does not re-enter on a second failure', async () => {
    const run = await runChild('twice-hung-shutdown');
    expect(run.code).toBe(1);
    expect(fatal(run)).toHaveLength(1);
    expect(run.records.filter((r) => r.event === 'shutdown-called')).toHaveLength(1);
  });
});

describe('sanitizeStack', () => {
  it('drops the message and shortens paths', () => {
    const error = new Error('secret ayse@example.com');
    error.stack = [
      'Error: secret ayse@example.com',
      `    at run (${process.cwd().replaceAll('\\', '/')}/src/job.ts:10:5)`,
      '    at async handler (file:///C:/Users/someone/proj/node_modules/.pnpm/pg@8/node_modules/pg/lib/client.js:3:9)',
      '    at /home/someone/app/dist/main.js:1:1',
    ].join('\n');
    const frames = sanitizeStack(error);
    expect(frames).toEqual([
      'at run (src/job.ts:10:5)',
      'at async handler (node_modules/pg/lib/client.js:3:9)',
      'at app/dist/main.js:1:1',
    ]);
    expect(frames.join('')).not.toContain('ayse');
  });

  it('does not let a multi-line message smuggle text into the frames', () => {
    const error = new Error('line\n    at injected (ayse@example.com)');
    expect(sanitizeStack(error).join('')).not.toContain('injected');
  });
});

describe('handler contract with controlled timers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(shutdown: () => Promise<void>, fatal = vi.fn()) {
    const target = new EventEmitter();
    const exit = vi.fn();
    installProcessHandlers({ logger: { fatal } as never, shutdown, target, exit });
    return { target, exit, fatal };
  }

  it('defaults the grace period to 5 seconds', async () => {
    expect(FATAL_SHUTDOWN_GRACE_MS).toBe(5_000);
    const { target, exit } = setup(() => new Promise(() => undefined));
    target.emit('uncaughtException', new Error('x'));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits as soon as a graceful stop completes', async () => {
    const { target, exit } = setup(() => Promise.resolve());
    target.emit('unhandledRejection', new Error('x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exit).toHaveBeenCalledTimes(1);
  });

  it('handles only the first failure', () => {
    const shutdown = vi.fn(() => new Promise<void>(() => undefined));
    const { target, fatal } = setup(shutdown);
    target.emit('uncaughtException', new Error('first'));
    target.emit('unhandledRejection', new Error('second'));
    target.emit('uncaughtException', new Error('third'));
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  it('still shuts down and exits when the logger throws', async () => {
    const shutdown = vi.fn(() => Promise.resolve());
    const { target, exit } = setup(
      shutdown,
      vi.fn(() => {
        throw new Error('log transport down');
      }),
    );
    expect(() => target.emit('uncaughtException', new Error('x'))).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(shutdown).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits when shutdown throws synchronously', () => {
    const { target, exit } = setup(() => {
      throw new Error('stop failed');
    });
    expect(() => target.emit('uncaughtException', new Error('x'))).not.toThrow();
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits when shutdown rejects', async () => {
    const { target, exit } = setup(() => Promise.reject(new Error('stop failed')));
    target.emit('unhandledRejection', new Error('x'));
    await vi.advanceTimersByTimeAsync(0);
    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
