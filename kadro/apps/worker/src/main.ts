import { EnvValidationError, loadWorkerEnv } from '@kadro/config';

import { describeError } from './job-runner.js';
import { createLogger } from './logger.js';
import { startWorker } from './runtime.js';

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    buildSha: env.BUILD_SHA,
    appEnv: env.APP_ENV,
  });

  const worker = await startWorker({ env, logger, fetch: globalThis.fetch });

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, 'worker stopping');
    worker
      .stop()
      .then(() => {
        logger.info('worker stopped');
      })
      .catch((error: unknown) => {
        logger.error(describeError(error), 'worker failed to stop cleanly');
        process.exitCode = 1;
      });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  // Configuration errors list offending keys only; other errors are reported without context data.
  const message =
    error instanceof EnvValidationError
      ? error.message
      : `worker failed to start: ${error instanceof Error ? error.message : String(error)}`;
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
