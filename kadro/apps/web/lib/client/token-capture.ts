import {
  type FragmentToken,
  type HistoryLike,
  type LocationLike,
  parseFragmentToken,
  takeFragmentToken,
} from './fragment-token';
import { PAGE_PATHS } from './redirects';

/**
 * In-memory holder of the email-link token over the life of the document (ADR-0040 steps 2 and
 * 5). The first capture runs while this module is evaluated. `instrumentation-client.ts` imports
 * it, and Next.js runs that file before any other application code and before the router reads
 * the URL, so the token never reaches the router state.
 *
 * The same document can receive another token later: a second email link opened in the same tab
 * only changes the fragment (`hashchange` / `popstate`, no reload), and a client navigation writes
 * the URL through `history.pushState` / `replaceState`. Both paths are covered: browser fragment
 * navigations are captured and stripped by the event listeners, and history writes that would put
 * a token fragment into an entry are rewritten to the bare path before they reach the browser.
 * A new token replaces the held one under a new version; the pages key their state by it, so a
 * new link starts a fresh, single-use flow.
 *
 * The token is released when the page is left: on `pagehide` (which also covers the back/forward
 * cache) and one task after the page component unmounts. Releasing aborts the request that
 * carries the token. The token lives only in this closure: never in `localStorage`,
 * `sessionStorage`, cookies or URL state, so a reload or a restored page asks for the link again.
 */

/** Pages whose fragment carries a token; on every other page the fragment is left alone. */
export const TOKEN_PAGES: readonly string[] = [PAGE_PATHS.verifyEmail, PAGE_PATHS.reset];

type HistoryWrite = (data: unknown, unused: string, url?: string | URL | null) => void;

/** The history methods the capture guards; both must be writable properties. */
export interface WritableHistory extends HistoryLike {
  pushState: HistoryWrite;
  replaceState: HistoryWrite;
}

export interface PageLocation extends LocationLike {
  readonly href: string;
}

type LifecycleEvent = 'hashchange' | 'popstate' | 'pagehide' | 'pageshow';

export interface BrowserLike {
  readonly location: PageLocation;
  readonly history: WritableHistory;
  addEventListener(
    type: LifecycleEvent,
    listener: (event: { readonly persisted?: boolean }) => void,
  ): void;
}

/** One captured token. A new link, or leaving the page, produces a new snapshot. */
export interface CaptureSnapshot {
  /** Changes whenever the token is replaced or released; pages key their flow state by it. */
  readonly version: number;
  readonly token: FragmentToken;
  /** Aborted when this token is replaced or released; requests carrying the token use it. */
  readonly signal: AbortSignal;
}

export interface TokenCapture {
  /** The held token when it was captured on `pathname`, otherwise `missing`. */
  read(pathname: string): FragmentToken;
  /** Like {@link read}, with the version and the abort signal of the held token. */
  readonly snapshot: (pathname: string) => CaptureSnapshot;
  /**
   * Registers a page that shows the token. When the last one leaves, the token is released one
   * task later, so an immediate remount (React strict-mode effects) keeps it. Safe to pass
   * unbound (`useSyncExternalStore`).
   */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Drops the token after success or a rejected token; later reads return `missing`. With
   * `version`, only that token is dropped, never a newer one that replaced it meanwhile.
   */
  forget(version?: number): void;
}

const MISSING: FragmentToken = Object.freeze({ kind: 'missing' });
const NOTHING: CaptureSnapshot = Object.freeze({
  version: -1,
  token: MISSING,
  signal: new AbortController().signal,
});

function isTokenPage(pathname: string): boolean {
  return TOKEN_PAGES.includes(pathname);
}

export function createTokenCapture(browser: BrowserLike | undefined): TokenCapture {
  let capturedOn: string | null = null;
  let controller = new AbortController();
  let current: CaptureSnapshot = Object.freeze({
    version: 0,
    token: MISSING,
    signal: controller.signal,
  });
  const listeners = new Set<() => void>();
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;

  const notify = () => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  /** Replaces the held token: the old one's request is aborted and a new version starts. */
  const replace = (pathname: string | null, token: FragmentToken) => {
    controller.abort();
    controller = new AbortController();
    capturedOn = pathname;
    current = Object.freeze({ version: current.version + 1, token, signal: controller.signal });
    notify();
  };

  /** A fragment seen on `pathname`; one without a token key leaves the held token alone. */
  const accept = (pathname: string, token: FragmentToken) => {
    if (token.kind === 'missing') {
      return;
    }
    const held = current.token;
    if (
      pathname === capturedOn &&
      token.kind === 'valid' &&
      held.kind === 'valid' &&
      held.token === token.token
    ) {
      return;
    }
    replace(pathname, token);
  };

  const release = () => {
    if (current.token.kind === 'valid') {
      replace(capturedOn, MISSING);
    }
  };

  if (browser !== undefined) {
    // Step 2: the token leaves the address bar before anything else reads the URL.
    if (isTokenPage(browser.location.pathname)) {
      capturedOn = browser.location.pathname;
      accept(capturedOn, takeFragmentToken(browser.location, browser.history));
    }

    const history = browser.history;
    // Advances on every history write and fragment navigation; a deferred router update runs
    // only while it still describes the latest one, so it never undoes a later navigation.
    let navigation = 0;
    const guard =
      (write: HistoryWrite): HistoryWrite =>
      (data, unused, url) => {
        navigation += 1;
        let target: URL | null = null;
        try {
          target = url === undefined || url === null ? null : new URL(url, browser.location.href);
        } catch {
          target = null;
        }
        if (target === null || target.hash === '' || !isTokenPage(target.pathname)) {
          write(data, unused, url);
          return;
        }
        const pathname = target.pathname;
        write(data, unused, pathname);
        accept(pathname, parseFragmentToken(target.hash));
        // The router keeps the URL it wrote in its own state and writes it again on its next
        // update. Telling it the bare path (through its history patch, when there is one) keeps
        // the fragment out of its state.
        const written = navigation;
        queueMicrotask(() => {
          if (navigation === written) {
            history.replaceState(null, '', pathname);
          }
        });
      };
    history.pushState = guard(history.pushState.bind(history));
    history.replaceState = guard(history.replaceState.bind(history));

    const fromLocation = () => {
      navigation += 1;
      const { pathname, hash } = browser.location;
      if (hash !== '' && isTokenPage(pathname)) {
        accept(pathname, takeFragmentToken(browser.location, browser.history));
      }
    };
    browser.addEventListener('hashchange', fromLocation);
    browser.addEventListener('popstate', fromLocation);
    browser.addEventListener('pagehide', release);
    browser.addEventListener('pageshow', (event) => {
      if (event.persisted === true) {
        release();
      }
    });
  }

  const snapshot = (pathname: string): CaptureSnapshot =>
    pathname === capturedOn ? current : NOTHING;

  return {
    read(pathname) {
      return snapshot(pathname).token;
    },
    snapshot,
    subscribe(listener) {
      clearTimeout(releaseTimer);
      releaseTimer = undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          clearTimeout(releaseTimer);
          releaseTimer = setTimeout(release, 0);
        }
      };
    },
    forget(version) {
      if (
        (version !== undefined && version !== current.version) ||
        current.token.kind === 'missing'
      ) {
        return;
      }
      current = Object.freeze({ ...current, token: MISSING });
      notify();
    },
  };
}

/** The page-wide capture, taken the moment this module is first evaluated in the browser. */
export const pageTokenCapture: TokenCapture = createTokenCapture(
  typeof window === 'undefined' ? undefined : window,
);
