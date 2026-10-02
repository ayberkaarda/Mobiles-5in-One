'use client';

import { type RefObject, useEffect, useSyncExternalStore } from 'react';

import { type ApiOutcome, type ApiRequest, sendApiRequest } from '../../lib/client/api';
import { type CaptureSnapshot, pageTokenCapture } from '../../lib/client/token-capture';

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
 * The token held for `pathname`, or `null` during the server render and hydration (the server
 * never sees the fragment). A new link opened in the same document, or leaving the page, yields a
 * snapshot with a new `version`. While mounted the page keeps the token; after it unmounts the
 * token is released and its pending request aborted.
 */
export function useCapturedToken(pathname: string): CaptureSnapshot | null {
  return useSyncExternalStore(
    pageTokenCapture.subscribe,
    () => pageTokenCapture.snapshot(pathname),
    () => null,
  );
}

/** Same-origin `fetch` of the browser; `signal` cancels the request. */
export function sendFromPage(request: ApiRequest, signal?: AbortSignal): Promise<ApiOutcome> {
  return sendApiRequest(
    (url, init) => fetch(url, signal === undefined ? init : { ...init, signal }),
    request,
  );
}

/** Moves focus to `ref` whenever `key` changes to a non-null value (new status content). */
export function useFocusOn(ref: RefObject<HTMLElement | null>, key: string | null): void {
  useEffect(() => {
    if (key !== null) {
      ref.current?.focus();
    }
  }, [ref, key]);
}
