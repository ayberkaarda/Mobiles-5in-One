'use client';

import { type RefObject, useEffect, useSyncExternalStore } from 'react';

import { type ApiOutcome, type ApiRequest, sendApiRequest } from '../../lib/client/api';
import { type FragmentToken } from '../../lib/client/fragment-token';
import { pageTokenCapture } from '../../lib/client/token-capture';

const subscribeNever = () => () => undefined;

/**
 * False during the server render and hydration, true afterwards. Forms keep their submit button
 * disabled until then, so a submit before the page script runs cannot fall back to a native form
 * submission that would put the fields into a URL.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

/**
 * The token captured from the fragment of `pathname` when the page script loaded, or `null`
 * during the server render and hydration (the server never sees the fragment).
 */
export function useCapturedToken(pathname: string): FragmentToken | null {
  return useSyncExternalStore(
    subscribeNever,
    () => pageTokenCapture.read(pathname),
    () => null,
  );
}

/** Same-origin `fetch` of the browser. */
export function sendFromPage(request: ApiRequest): Promise<ApiOutcome> {
  return sendApiRequest((url, init) => fetch(url, init), request);
}

/** Moves focus to `ref` whenever `key` changes to a non-null value (new status content). */
export function useFocusOn(ref: RefObject<HTMLElement | null>, key: string | null): void {
  useEffect(() => {
    if (key !== null) {
      ref.current?.focus();
    }
  }, [ref, key]);
}
