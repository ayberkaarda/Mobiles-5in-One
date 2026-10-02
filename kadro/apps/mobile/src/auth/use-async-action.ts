import { useCallback, useRef, useState } from 'react';

export interface AsyncAction {
  /** `true` while the action runs; the submit button shows it and ignores presses. */
  readonly busy: boolean;
  /** The failure of the last run, `null` after a success or a new run. */
  readonly error: unknown;
  /** Runs `task` unless one is already running; resolves to whether it completed without error. */
  run(task: () => Promise<void>): Promise<boolean>;
  clearError(): void;
}

/**
 * One in-flight action per form: a second press while the first runs is ignored (no double
 * submit of a single-use token or a registration),.
 */
export function useAsyncAction(): AsyncAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const running = useRef(false);

  const run = useCallback(async (task: () => Promise<void>): Promise<boolean> => {
    if (running.current) {
      return false;
    }
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (caught) {
      setError(caught);
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { busy, error, run, clearError };
}
