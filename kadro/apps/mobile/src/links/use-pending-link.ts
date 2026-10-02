import { type Href, usePathname, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useStore } from 'zustand';

import { type AuthStatus } from '../auth-store/store';
import { pendingLinkStep } from './deep-links';
import { type PendingLinkStore } from './pending';

/**
 * Opens the link held across the sign-in (ADR-0075) as soon as the user is signed in, then drops
 * it. Used once, in the root stack.
 */
export function usePendingLink(store: PendingLinkStore, status: AuthStatus): void {
  const router = useRouter();
  const pathname = usePathname();
  const target = useStore(store, (state) => state.target);

  useEffect(() => {
    const step = pendingLinkStep(status, target, pathname);
    if (step.action === 'wait') {
      return;
    }
    store.setState({ target: null });
    if (step.action === 'open') {
      router.push(step.href as Href);
    }
  }, [status, target, pathname, router, store]);
}
