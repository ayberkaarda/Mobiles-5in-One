import { useEffect } from 'react';
import { useStore } from 'zustand';

import { type AuthStatus } from '../auth-store/store';
import { profileApi } from '../profile/instance';
import { pushPort, pushStore } from '../settings/push-instance';
import { refreshRegistration } from '../settings/push';

/**
 * Registers this device's token once per sign-in when notifications are already allowed
 * (ADR-0031 start-up refresh). Silent: it never shows the system prompt, and a failure only leaves
 * the settings showing "register this device".
 */
export function usePushRefresh(status: AuthStatus): void {
  const registered = useStore(pushStore, (state) => state.registered);

  useEffect(() => {
    if (status !== 'signedIn' || registered) {
      return;
    }
    let active = true;
    refreshRegistration(pushPort, profileApi)
      .then((outcome) => {
        if (active && outcome === 'registered') {
          pushStore.setState({ registered: true });
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [status, registered]);
}
