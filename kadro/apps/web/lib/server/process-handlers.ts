/**
 * Last line of defence for the Node.js server process. This module has no imports so it can be
 * loaded on its own (the tests run it in a child process).
 *
 * - `uncaughtException`: the process state is unknown. The error is logged at `fatal` and the
 *   process exits with code 1 so the platform restarts it.
 * - `unhandledRejection`: a forgotten promise rarely corrupts the process, and request handlers
 *   already convert their own failures to responses. It is logged at `error` and the process
 *   keeps serving; Next.js and the runtime stay in charge of everything they handle themselves.
 *
 * Errors go through the logger's `err` serializer (SQL text and e-mail addresses removed). The
 * handlers never throw.
 */
export interface FatalLogger {
  fatal(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
}

export interface ProcessHandlerOptions {
  readonly logger: FatalLogger;
  /** Test seams. */
  readonly target?: {
    on(
      event: 'uncaughtException' | 'unhandledRejection',
      listener: (arg: unknown) => void,
    ): unknown;
  };
  readonly exit?: (code: number) => void;
}

/** Marks a target that already has the handlers, so repeated set-up (hot reload) adds nothing. */
const INSTALLED = Symbol.for('kadro.web.processHandlers');

export function installProcessHandlers(options: ProcessHandlerOptions): void {
  const target = options.target ?? process;
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const marked = target as { [INSTALLED]?: true };
  if (marked[INSTALLED] === true) {
    return;
  }
  marked[INSTALLED] = true;
  let exiting = false;

  target.on('uncaughtException', (error: unknown) => {
    if (exiting) {
      return;
    }
    exiting = true;
    try {
      options.logger.fatal({ err: error, kind: 'uncaughtException' }, 'uncaught exception');
    } catch {
      // A failing logger must not prevent the exit.
    }
    exit(1);
  });

  target.on('unhandledRejection', (reason: unknown) => {
    try {
      options.logger.error({ err: reason, kind: 'unhandledRejection' }, 'unhandled rejection');
    } catch {
      // Logging is best effort.
    }
  });
}
