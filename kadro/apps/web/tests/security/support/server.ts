import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { type AddressInfo, createServer as createNetServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { testEnvSource } from '../../support/env';

/** Helpers that run the production build or a bare HTTP server for the security suites. */

export const APP_DIR = fileURLToPath(new URL('../../../', import.meta.url));
export const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));
const NEXT_BIN = fileURLToPath(
  new URL('../../../node_modules/next/dist/bin/next', import.meta.url),
);

/** True when `next build` output exists for apps/web. */
// eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed path inside this package
export const BUILD_PRESENT = existsSync(
  fileURLToPath(new URL('../../../.next/BUILD_ID', import.meta.url)),
);

export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => {
        resolve(port);
      });
    });
  });
}

export interface RunningServer {
  readonly base: string;
  stop(): Promise<void>;
}

/** Starts `next start` on the existing build with only the generated test configuration. */
export async function startBuiltServer(): Promise<RunningServer> {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const child: ChildProcess = spawn(
    process.execPath,
    [NEXT_BIN, 'start', '--port', String(port), '-H', '127.0.0.1'],
    {
      cwd: APP_DIR,
      // No variable of the calling shell is inherited.
      env: {
        ...testEnvSource({ WEB_ORIGIN: base, CORS_ALLOWED_ORIGINS: base }),
        NODE_ENV: 'production',
      },
      stdio: 'ignore',
      windowsHide: true,
    },
  );
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const response = await fetch(`${base}/api/v1/health`);
      await response.arrayBuffer();
      if (response.ok) {
        break;
      }
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline || child.exitCode !== null) {
      child.kill();
      throw new Error('built server did not become ready');
    }
    await delay(250);
  }
  return {
    base,
    stop: () =>
      new Promise((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once('exit', () => {
          resolve();
        });
        child.kill();
      }),
  };
}

/** A server that answers every request with 200 and no security headers at all. */
export async function startBareServer(): Promise<RunningServer> {
  const server: Server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<!doctype html><title>bare</title>');
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    stop: () =>
      new Promise((resolve) => {
        server.close(() => {
          resolve();
        });
      }),
  };
}

export interface ScriptRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs a TypeScript script under scripts/security with Node.js type stripping. */
export function runScript(script: string, args: readonly string[]): Promise<ScriptRun> {
  const file = fileURLToPath(new URL(`../../../../../scripts/security/${script}`, import.meta.url));
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [file, ...args],
      { cwd: REPOSITORY_ROOT, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout, stderr });
      },
    );
  });
}
