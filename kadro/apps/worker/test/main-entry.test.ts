import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_INCOMING_BUCKET, TEST_MEDIA_BUCKET } from './fake-s3.js';
import {
  type FakeProvider,
  type TestDatabase,
  createTestDatabase,
  startFakeProvider,
} from './support.js';

let database: TestDatabase;
let provider: FakeProvider;

beforeAll(async () => {
  database = await createTestDatabase('worker_main_entry');
  provider = await startFakeProvider();
});

afterAll(async () => {
  await provider.close();
  await database.dispose();
});

const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url));
const PRELOAD = fileURLToPath(new URL('./fixtures/main-entry-preload.mjs', import.meta.url));
const MAIN = fileURLToPath(new URL('../src/main.ts', import.meta.url));

describe('worker entry point', () => {
  it('installs the process-level handlers', async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--import', pathToFileURL(PRELOAD).href, MAIN],
      {
        cwd: WORKER_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          NODE_ENV: 'test',
          BUILD_SHA: 'test',
          LOG_LEVEL: 'info',
          APP_ENV: 'local',
          DATABASE_URL: database.workerUrl,
          WEB_ORIGIN: 'http://localhost:3000',
          EMAIL_TRANSPORT: 'resend',
          RESEND_API_KEY: 're_entrypointtestkey000000',
          EMAIL_FROM: 'Kadro <bildirim@kadro.app>',
          PUSH_TRANSPORT: 'expo',
          EXPO_ACCESS_TOKEN: 'entrypointtesttoken0000000000000',
          R2_ENDPOINT: provider.origin,
          R2_ACCESS_KEY_ID: 'kadro-test',
          R2_SECRET_ACCESS_KEY: 'A'.repeat(32),
          R2_INCOMING_BUCKET: TEST_INCOMING_BUCKET,
          R2_MEDIA_BUCKET: TEST_MEDIA_BUCKET,
        },
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => child.kill(), 50_000);
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    clearTimeout(timer);

    const fatal = stdout
      .split('\n')
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((record) => record.level === 60);
    expect(code, stderr).toBe(1);
    expect(
      fatal,
      `${stdout}
${stderr}`,
    ).toHaveLength(1);
    expect(fatal[0]).toMatchObject({ kind: 'uncaughtException', service: 'kadro-worker' });
    expect(stdout).not.toContain('ayse@example.com');
  });
});
