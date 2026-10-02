import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '../lib/server/logging';
import { installProcessHandlers } from '../lib/server/process-handlers';

const SCRIPT = fileURLToPath(
  new URL('./support/fixtures/process-handlers-child.mjs', import.meta.url),
);

interface ChildRun {
  readonly code: number | null;
  readonly records: Record<string, unknown>[];
}

async function runChild(mode: string): Promise<ChildRun> {
  // The child loads the TypeScript source directly; the flag keeps this working on every
  // supported Node 22.x (newer releases enable type stripping by default).
  const child = spawn(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', SCRIPT, mode],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
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
  return { code, records };
}

describe('process-level handlers', () => {
  it('uncaughtException: logs fatal and exits non-zero', async () => {
    const run = await runChild('throw');
    expect(run.code).toBe(1);
    expect(run.records.filter((r) => r.level === 60)).toHaveLength(1);
  });

  it('unhandledRejection: logs an error and keeps the process running', async () => {
    const run = await runChild('reject');
    expect(run.code).toBe(0);
    expect(run.records.filter((r) => r.level === 50)).toHaveLength(1);
    expect(run.records.some((r) => r.event === 'still-running')).toBe(true);
  });

  it('masks e-mail addresses and never throws when the logger does', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => void lines.push(line) },
    });
    const target = new EventEmitter();
    const exit = vi.fn();
    installProcessHandlers({ logger, target, exit });

    target.emit('unhandledRejection', new Error('failed for ayse@example.com'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('ayse@example.com');
    expect(lines[0]).toContain('a***@e***');
    expect(exit).not.toHaveBeenCalled();

    const throwing = {
      fatal: () => {
        throw new Error('logger down');
      },
      error: () => {
        throw new Error('logger down');
      },
    };
    const other = new EventEmitter();
    installProcessHandlers({ logger: throwing, target: other, exit });
    expect(() => other.emit('unhandledRejection', new Error('x'))).not.toThrow();
    expect(() => other.emit('uncaughtException', new Error('x'))).not.toThrow();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('is idempotent per target', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      destination: { write: (line: string) => void lines.push(line) },
    });
    const target = new EventEmitter();
    const exit = vi.fn();
    installProcessHandlers({ logger, target, exit });
    installProcessHandlers({ logger, target, exit });
    expect(target.listenerCount('uncaughtException')).toBe(1);
    expect(target.listenerCount('unhandledRejection')).toBe(1);

    target.emit('unhandledRejection', new Error('x'));
    expect(lines).toHaveLength(1);
    target.emit('uncaughtException', new Error('y'));
    target.emit('uncaughtException', new Error('z'));
    expect(exit).toHaveBeenCalledTimes(1);
  });
});
