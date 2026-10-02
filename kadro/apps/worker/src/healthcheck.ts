import { defaultHealthFile, readHealth } from './health.js';

/** Container health check: exit 0 when the worker reported `ready` within the last 90 s. */
const verdict = await readHealth(defaultHealthFile());
if (verdict.healthy) {
  process.stdout.write('kadro-worker healthy\n');
} else {
  process.stderr.write(`kadro-worker unhealthy: ${verdict.reason}\n`);
  process.exitCode = 1;
}
