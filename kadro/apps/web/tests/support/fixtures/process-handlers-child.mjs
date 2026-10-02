// Runs in a separate Node process (see tests/process-handlers.test.ts). It installs the
// process-level handlers, then triggers an unhandled failure and reports what happened.
import { installProcessHandlers } from '../../../lib/server/process-handlers.ts';

const mode = process.argv[2];
const write = (level, obj, msg) =>
  process.stdout.write(`${JSON.stringify({ level, ...obj, msg })}\n`);
const logger = {
  fatal: (obj, msg) => write(60, obj, msg),
  error: (obj, msg) => write(50, obj, msg),
};

installProcessHandlers({ logger });

setTimeout(() => {
  if (mode === 'throw') {
    throw new Error('boom');
  }
  if (mode === 'reject') {
    Promise.reject(new Error('rejected'));
    // The process must keep running after a rejection.
    setTimeout(() => {
      process.stdout.write('{"event":"still-running"}\n');
      process.exit(0);
    }, 100);
  }
}, 20);
// Keeps the loop alive so a missing handler is the only reason for the process to end early.
setInterval(() => undefined, 1_000);
