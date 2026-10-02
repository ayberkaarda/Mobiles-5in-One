// Runs in a separate Node process (see process-handlers.test.ts, loaded through tsx). It installs
// the process-level handlers, then triggers an unhandled failure and reports what happened.
import { installProcessHandlers } from '../../src/process-handlers.ts';
import { createLogger } from '../../src/logger.ts';

const mode = process.argv[2];
const logger = createLogger({ level: 'info', buildSha: 'test', appEnv: 'test' });
const emit = (event) => process.stdout.write(`${JSON.stringify({ event })}\n`);

installProcessHandlers({
  logger,
  graceMs: 400,
  shutdown: () => {
    emit('shutdown-called');
    return mode.endsWith('-hung-shutdown') ? new Promise(() => undefined) : Promise.resolve();
  },
});

// Keeps the loop alive so a missing handler is the only reason for the process to end early.
setInterval(() => undefined, 1_000);

setTimeout(() => {
  if (mode.startsWith('throw')) {
    throw new Error('boom for ayse@example.com');
  }
  if (mode.startsWith('reject')) {
    Promise.reject(new Error('rejected for ayse@example.com'));
  }
  if (mode.startsWith('twice')) {
    Promise.reject(new Error('first'));
    setTimeout(() => {
      throw new Error('second');
    }, 20);
  }
}, 20);
