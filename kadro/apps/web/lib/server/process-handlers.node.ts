import { fallbackLogger } from './logging';
import { installProcessHandlers } from './process-handlers';

/** Node.js runtime: installs the process-level handlers with the redacting logger. */
export function installNodeProcessHandlers(): void {
  installProcessHandlers({ logger: fallbackLogger() });
}
