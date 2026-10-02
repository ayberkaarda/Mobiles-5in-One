import { loadMobilePublicEnv } from '@kadro/config/mobile';

import { allowedLinkOrigins } from './deep-links';
import { createPendingLinkStore } from './pending';

let origins: readonly string[] | null = null;

/**
 * https origins whose links the app opens (the configured web origin); empty in local builds
 * without one. Read on first use, so screens that only show the held link do not read the
 * build-time environment.
 */
export function linkOrigins(): readonly string[] {
  origins ??= allowedLinkOrigins(loadMobilePublicEnv().EXPO_PUBLIC_WEB_ORIGIN);
  return origins;
}

export const pendingLink = createPendingLinkStore();
