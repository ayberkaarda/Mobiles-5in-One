import { authStore } from '../src/auth-store/store';
import { routeIncomingLink } from '../src/links/deep-links';
import { linkOrigins, pendingLink } from '../src/links/instance';

/**
 * Every link the operating system hands to the app passes here before the router sees it
 * (custom scheme and verified https links, cold start and while running). A signed-in-only target
 * opened without a session is held in memory and opened after sign-in (ADR-0075).
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string | null {
  try {
    const result = routeIncomingLink(path, authStore.getState().status, linkOrigins());
    if (result.pending !== null) {
      pendingLink.setState({ target: result.pending });
    }
    return result.path ?? path;
  } catch {
    // Never crash on a link: let the router handle it as given.
    return path;
  }
}
