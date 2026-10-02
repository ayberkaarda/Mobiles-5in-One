import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { type PushPermission, type PushPort } from './push';

/** EAS project id the Expo push service issues tokens for; absent in local builds. */
function projectId(): string | null {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: unknown } } | undefined;
  const id = extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return typeof id === 'string' && id !== '' ? id : null;
}

function permissionOf(status: Notifications.NotificationPermissionsStatus): PushPermission {
  if (status.granted) {
    return 'granted';
  }
  return status.canAskAgain ? 'undetermined' : 'denied';
}

/** Android 13+ asks for the permission only once a channel exists. */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Kadro',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

/**
 * `expo-notifications` behind the push port. Needs a device build with an EAS project id (and on
 * Android the FCM configuration); without a project id the port reports push as unavailable. Not
 * exercised by the unit tests, which use a fake port.
 */
export function createNativePushPort(): PushPort {
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null;
  const id = projectId();
  return {
    platform: id === null ? null : platform,
    permission: async () => permissionOf(await Notifications.getPermissionsAsync()),
    async requestPermission() {
      const current = await Notifications.getPermissionsAsync();
      if (current.granted || !current.canAskAgain) {
        return permissionOf(current);
      }
      await ensureAndroidChannel();
      return permissionOf(await Notifications.requestPermissionsAsync());
    },
    async expoToken() {
      if (id === null) {
        throw new Error('push is not configured for this build');
      }
      const token = await Notifications.getExpoPushTokenAsync({ projectId: id });
      return token.data;
    },
  };
}
