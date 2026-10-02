import {
  type FragmentToken,
  type HistoryLike,
  type LocationLike,
  takeFragmentToken,
} from './fragment-token';
import { PAGE_PATHS } from './redirects';

/**
 * In-memory holder of the email-link token (ADR-0040 steps 2 and 5). The capture runs while this
 * module is evaluated. `instrumentation-client.ts` imports it, and Next.js runs that file before
 * any other application code and before the router reads the URL, so the token never reaches the
 * router state, which would otherwise write the fragment back into the history entry. The token
 * lives only in this closure: never in `localStorage`, `sessionStorage`, cookies or URL state. A
 * reload therefore asks the user to open the link again.
 */

/** Pages whose fragment carries a token; on every other page the fragment is left alone. */
export const TOKEN_PAGES: readonly string[] = [PAGE_PATHS.verifyEmail, PAGE_PATHS.reset];

export interface BrowserLike {
  readonly location: LocationLike;
  readonly history: HistoryLike;
}

export interface TokenCapture {
  /** The captured result when it was taken on `pathname`, otherwise `missing`. */
  read(pathname: string): FragmentToken;
  /** Drops the token (after success or a rejected token); later reads return `missing`. */
  forget(): void;
}

const MISSING: FragmentToken = Object.freeze({ kind: 'missing' });

export function createTokenCapture(browser: BrowserLike | undefined): TokenCapture {
  // Server render, or a page without a token: nothing to read.
  let captured: FragmentToken = MISSING;
  let capturedOn: string | null = null;
  if (browser !== undefined && TOKEN_PAGES.includes(browser.location.pathname)) {
    capturedOn = browser.location.pathname;
    captured = takeFragmentToken(browser.location, browser.history);
  }
  return {
    read(pathname) {
      return pathname === capturedOn ? captured : MISSING;
    },
    forget() {
      captured = MISSING;
      capturedOn = null;
    },
  };
}

/** The page-wide capture, taken the moment this module is first evaluated in the browser. */
export const pageTokenCapture: TokenCapture = createTokenCapture(
  typeof window === 'undefined' ? undefined : window,
);
