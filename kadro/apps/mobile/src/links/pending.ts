import { createStore } from 'zustand/vanilla';

import { type SessionLinkTarget } from './deep-links';

export interface PendingLinkState {
  /** A link opened while signed out, opened after the next sign-in. */
  readonly target: SessionLinkTarget | null;
}

/**
 * The link held across the sign-in. Memory only, never persisted: an invite code is a bearer
 * value for joining a team (ADR-0034), so it must not outlive the process or reach unencrypted
 * storage. A newer link replaces an older one; quitting the app drops it.
 */
export function createPendingLinkStore() {
  return createStore<PendingLinkState>()(() => ({ target: null }));
}

export type PendingLinkStore = ReturnType<typeof createPendingLinkStore>;
