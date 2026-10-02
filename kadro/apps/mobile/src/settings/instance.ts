import { loadMobilePublicEnv } from '@kadro/config/mobile';

import { session } from '../api/instance';
import { legalLinks } from './legal';
import { createPushStore } from './push';
import { createNativePushPort } from './push-native';

const { EXPO_PUBLIC_WEB_ORIGIN: webOrigin } = loadMobilePublicEnv();

/** Legal pages on the configured web origin; empty in local builds without one. */
export const appLegalLinks = legalLinks(webOrigin);

export const pushPort = createNativePushPort();
export const pushStore = createPushStore();

// The push registration belongs to one sign-in; any sign-out (user, expiry, deletion) resets it.
session.onSignOut(() => {
  pushStore.setState({ registered: false });
});
