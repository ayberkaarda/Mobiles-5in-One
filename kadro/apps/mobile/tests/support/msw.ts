import { setupServer } from 'msw/node';

/** Base URL the API client uses in tests; never a real host. */
export const TEST_API_URL = 'https://api.test.kadro.invalid';

/** Shared MSW server; tests add handlers with `mswServer.use(...)`. */
export const mswServer = setupServer();

export function apiUrl(path: string): string {
  return `${TEST_API_URL}${path}`;
}
