import * as Notifications from 'expo-notifications';
import { type Href, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { type AuthStatus } from '../auth-store/store';
import { notificationHref, parseNotificationData } from './routing';

/**
 * `expo-notifications` wiring of the root layout. Native only: the unit tests cover the pure
 * parts (`routing.ts`, `prompt.ts`, `settings/push.ts`) with fakes.
 */

/** A notification that arrives while the app is open shows as a banner, without sound or badge. */
export function configureForegroundNotifications(): void {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

/** Responses already acted on in this process (the hook can see the same response again). */
const handled = new Set<string>();

/**
 * Opens the screen of a tapped notification, also when the tap started the app. A tap while
 * signed out is dropped: the notification may belong to an account that signed out on this
 * device, and the next user must not be routed by it.
 */
export function useNotificationRouting(
  status: AuthStatus,
  loadMatchTeam: (matchId: string) => Promise<string>,
): void {
  const router = useRouter();
  const response = Notifications.useLastNotificationResponse();

  useEffect(() => {
    if (response === undefined || response === null || status === 'unknown') {
      return;
    }
    const id = response.notification.request.identifier;
    if (handled.has(id)) {
      return;
    }
    handled.add(id);
    Notifications.clearLastNotificationResponse();
    if (
      status !== 'signedIn' ||
      response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER
    ) {
      return;
    }
    const target = parseNotificationData(response.notification.request.content.data);
    if (target === null) {
      return;
    }
    void notificationHref(target, loadMatchTeam).then((href) => router.push(href as Href));
  }, [response, status, loadMatchTeam, router]);
}
