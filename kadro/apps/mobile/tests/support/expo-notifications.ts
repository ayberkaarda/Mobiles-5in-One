/**
 * Test double of `expo-notifications` for modules that load the native push port. The tests use
 * fake ports; this module only has to load, and reports "not decided" if it is ever asked.
 */
const undecided = { granted: false, canAskAgain: true, status: 'undetermined' };

export const AndroidImportance = { DEFAULT: 3 };
export const DEFAULT_ACTION_IDENTIFIER = 'expo.modules.notifications.actions.DEFAULT';

export async function getPermissionsAsync() {
  return undecided;
}

export async function requestPermissionsAsync() {
  return undecided;
}

export async function setNotificationChannelAsync(): Promise<null> {
  return null;
}

export async function getExpoPushTokenAsync(): Promise<never> {
  throw new Error('push is not available in tests');
}

export function setNotificationHandler(): void {
  // Nothing to configure in tests.
}

export function useLastNotificationResponse(): null {
  return null;
}

export function clearLastNotificationResponse(): void {
  // No stored response in tests.
}
