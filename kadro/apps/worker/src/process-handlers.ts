import { type Logger } from 'pino';

/** Error type and driver/system code only; messages can embed personal data. */
function describeFatal(reason: unknown): Record<string, string> {
  if (!(reason instanceof Error)) {
    return { errorType: typeof reason };
  }
  const code = (reason as { code?: unknown }).code;
  return typeof code === 'string'
    ? { errorType: reason.name, errorCode: code }
    : { errorType: reason.name };
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
 * an unknown state. The failure is logged at `fatal` (error type and code only, so messages that
 * carry personal data stay out of the log), a graceful stop gets a few seconds, and the process
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
      process.exitCode = 1;
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
