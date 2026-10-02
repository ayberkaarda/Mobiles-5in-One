import { session } from '../api/instance';
import { createPushStore } from './push';
import { createNativePushPort } from './push-native';

/**
 * The app's push port and registration state. Kept apart from `instance.ts`, which also reads the
 * build-time web origin, so screens that only need push (the matches tab card, the root layout's
 * start-up refresh) do not depend on it.
 */
export const pushPort = createNativePushPort();
export const pushStore = createPushStore();

// The push registration belongs to one sign-in; any sign-out (user, expiry, deletion) resets it.
session.onSignOut(() => {
  pushStore.setState({ registered: false });
});
