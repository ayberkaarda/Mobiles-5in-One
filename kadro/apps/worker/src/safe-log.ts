/**
 * Runs a logging call and swallows any error it throws. Event listeners (pg-boss, database
 * clients) run on the emitter's stack, where a throwing logger would become an uncaught exception
 * and take the process down; a failed log line is never worth that.
 */
export function safeLog(write: () => void): void {
  try {
    write();
  } catch {
    // Logging is best effort.
  }
}
