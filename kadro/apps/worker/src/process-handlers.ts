import { type Logger } from 'pino';

const MAX_FRAMES = 25;
const FRAME_LINE = /^\s+at\s/;
const EMAIL = /[^\s@<>"'(),;:]+@[^\s@<>"'(),;:]+/g;

function shortenPath(frame: string): string {
  let text = frame.replace(/file:\/\/\/?/g, '').replaceAll('\\', '/');
  const cwd = process.cwd().replaceAll('\\', '/');
  text = text.split(`${cwd}/`).join('');
  // Dependencies: keep the package-relative part only.
  text = text.replace(
    /[^\s(]*\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?/g,
    'node_modules/',
  );
  // Anything still absolute (system paths, a home directory) keeps its last three segments.
  return text.replace(/(?<![^\s(])(?:[A-Za-z]:)?\/[^\s():]+(?:\/[^\s():]+)+/g, (path) =>
    path.split('/').slice(-3).join('/'),
  );
}

/**
 * Stack frames only (function, file, line, column): the header line carries the error message,
 * which can embed personal data, so it is removed before the frames are picked out. Paths are made
 * relative to the working directory and dependency paths are shortened.
 */
export function sanitizeStack(error: Error): string[] {
  const stack = error.stack ?? '';
  const withoutMessage = error.message === '' ? stack : stack.split(error.message).join('');
  return withoutMessage
    .split('\n')
    .filter((line) => FRAME_LINE.test(line))
    .slice(0, MAX_FRAMES)
    .map((line) => shortenPath(line.trim()).replace(EMAIL, '[REDACTED]'));
}

/** Error type, driver/system code and stack frames; messages can embed personal data. */
function describeFatal(reason: unknown): Record<string, unknown> {
  if (!(reason instanceof Error)) {
    return { errorType: typeof reason };
  }
  const code = (reason as { code?: unknown }).code;
  const fields: Record<string, unknown> = { errorType: reason.name };
  if (typeof code === 'string') {
    fields.errorCode = code;
  }
  try {
    fields.stack = sanitizeStack(reason);
  } catch {
    // The stack is optional; the record is still written.
  }
  return fields;
}

/** Upper bound for the graceful stop that runs after an unhandled failure. */
export const FATAL_SHUTDOWN_GRACE_MS = 5_000;

export interface ProcessHandlerOptions {
  readonly logger: Pick<Logger, 'fatal'>;
  /** Stops the worker; called once, bounded by `graceMs`. */
  readonly shutdown: () => Promise<void>;
  readonly graceMs?: number;
  /** Test seams. */
  readonly target?: Pick<NodeJS.Process, 'on'>;
  readonly exit?: (code: number) => void;
}

/**
 * Last line of defence (ADR-0028): an exception or rejection nobody handled leaves the process in
 * an unknown state. The failure is logged at `fatal` (error type, code and stack frames; the message,
 * which can carry personal data, is left out), a graceful stop gets a few seconds, and the process
 * then exits non-zero so the supervisor restarts it. The handler never throws and runs once.
 */
export function installProcessHandlers(options: ProcessHandlerOptions): void {
  const target = options.target ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const graceMs = options.graceMs ?? FATAL_SHUTDOWN_GRACE_MS;
  let handling = false;

  const handle = (kind: 'uncaughtException' | 'unhandledRejection') => (reason: unknown) => {
    if (handling) {
      return;
    }
    handling = true;
    try {
      try {
        options.logger.fatal({ kind, ...describeFatal(reason) }, 'unhandled process error');
      } catch {
        // A failing logger must not prevent the exit.
      }
      let done = false;
      const finish = (): void => {
        if (!done) {
          done = true;
          exit(1);
        }
      };
      setTimeout(finish, graceMs);
      try {
        options.shutdown().then(finish, finish);
      } catch {
        finish();
      }
    } catch {
      exit(1);
    }
  };

  target.on('uncaughtException', handle('uncaughtException'));
  target.on('unhandledRejection', handle('unhandledRejection'));
}
