import { startStack } from './support/stack';

/**
 * Starts the local stack once for the run and hands the seeded state to the workers through the
 * environment (Playwright copies it into worker processes). The returned function is the teardown.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  const stack = await startStack();
  // eslint-disable-next-line no-restricted-properties -- test-run hand-over between Playwright processes, not application configuration
  process.env.KADRO_E2E_STATE = JSON.stringify(stack.state);
  return () => stack.stop();
}
