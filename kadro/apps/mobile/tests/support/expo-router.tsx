/**
 * Test double of `expo-router` for screen tests: the router records its calls, route parameters
 * are set by the test. Navigation itself (stacks, guards) is not simulated.
 */
export interface RouterCall {
  readonly method: 'push' | 'replace' | 'back';
  readonly href: string | null;
}

let calls: RouterCall[] = [];
let params: Record<string, string | string[] | undefined> = {};
let backAvailable = false;

const router = {
  push(href: string) {
    calls.push({ method: 'push', href });
  },
  replace(href: string) {
    calls.push({ method: 'replace', href });
  },
  back() {
    calls.push({ method: 'back', href: null });
  },
  canGoBack: () => backAvailable,
};

export function useRouter() {
  return router;
}

export function useLocalSearchParams<T extends Record<string, unknown>>(): T {
  return params as T;
}

/** Calls made on the router since the last reset, in order. */
export function routerCalls(): readonly RouterCall[] {
  return calls;
}

export function __setSearchParams(next: Record<string, string | string[] | undefined>): void {
  params = next;
}

export function __setCanGoBack(next: boolean): void {
  backAvailable = next;
}

export function resetRouterDouble(): void {
  calls = [];
  params = {};
  backAvailable = false;
}
