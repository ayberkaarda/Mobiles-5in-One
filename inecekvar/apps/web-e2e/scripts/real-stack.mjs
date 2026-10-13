// Starts or removes the local API stack for the real-API e2e runs (ADR-0041, ADR-0052): compose
// project `iv4e` (PostgreSQL/PostGIS, Redis, MinIO, Mailpit) on 127.0.0.1 ports 57941-57946, or
// with IV_E2E_STACK=iv6b project `iv6b` on 57951-57956; a fresh database with migrations and the
// sample city, and Redis flushed so rate limits start empty. Playwright then runs uvicorn (and,
// for the XSS sweep, an SSR server reading it) itself when IV_E2E_REAL_API=1.
//
//   node apps/web-e2e/scripts/real-stack.mjs up     # reset and prepare
//   node apps/web-e2e/scripts/real-stack.mjs down   # stop and remove containers and volumes
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REAL_STACK } from '../stack-env.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const workspace = resolve(here, '../../..');
const apiDir = resolve(workspace, 'api');
const compose = [
  'compose',
  '-p',
  REAL_STACK.project,
  '-f',
  resolve(workspace, 'docker-compose.yml'),
];
const services = ['postgres', 'redis', 'minio', 'minio-init', 'mailpit'];

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function composeEnv() {
  return { ...process.env, ...REAL_STACK.composePorts };
}

const action = process.argv[2];
if (action === 'down') {
  run('docker', [...compose, 'down', '-v', '--remove-orphans'], { env: composeEnv() });
} else if (action === 'up') {
  run('docker', [...compose, 'down', '-v', '--remove-orphans'], { env: composeEnv() });
  run(
    'docker',
    [...compose, 'up', '-d', '--wait', ...services.filter((name) => name !== 'minio-init')],
    {
      env: composeEnv(),
    },
  );
  run('docker', [...compose, 'up', '-d', 'minio-init'], { env: composeEnv() });
  run('docker', ['exec', `${REAL_STACK.project}-redis-1`, 'redis-cli', 'FLUSHALL']);
  const apiEnv = { ...process.env, ...REAL_STACK.apiEnv };
  run('uv', ['run', 'alembic', 'upgrade', 'head'], { cwd: apiDir, env: apiEnv });
  run('uv', ['run', 'python', '-m', 'app.seed'], { cwd: apiDir, env: apiEnv });
  console.log(`Stack ${REAL_STACK.project} ready; set IV_E2E_REAL_API=1 for the moderation spec.`);
} else {
  console.error('usage: real-stack.mjs up|down');
  process.exit(2);
}
