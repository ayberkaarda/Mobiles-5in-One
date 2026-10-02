import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
