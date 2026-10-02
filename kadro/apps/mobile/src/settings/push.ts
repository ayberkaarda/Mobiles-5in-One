import { createStore } from 'zustand/vanilla';

import { type PushPlatform, type RegisterPushTokenRequest } from '../profile/contracts';
import { type ProfileApi } from '../profile/profile-api';

export type PushPermission = 'granted' | 'denied' | 'undetermined';

/**
 * Port to the platform notification service (`expo-notifications` in the app, a fake in tests).
 * Receiving and opening notifications is not part of this port (deep-link and push handling
 * work package).
 */
export interface PushPort {
  /** `null` when push cannot work on this build or device (no project id, unsupported platform). */
  readonly platform: PushPlatform | null;
  permission(): Promise<PushPermission>;
  /** Shows the system prompt when the user has not decided yet; otherwise reports the decision. */
  requestPermission(): Promise<PushPermission>;
  /** The Expo push token of this installation; rejects when the service cannot issue one. */
  expoToken(): Promise<string>;
}

/** Contracts `registerPushTokenRequestSchema.expoToken` (tests compare). */
export const EXPO_TOKEN_MAX = 256;
const EXPO_TOKEN_PATTERN = /^Expo(?:nent)?PushToken\[[A-Za-z0-9_-]{1,200}\]$/;

export function isExpoPushToken(value: string): boolean {
  return value.length <= EXPO_TOKEN_MAX && EXPO_TOKEN_PATTERN.test(value);
}

/**
 * - `unavailable`: push cannot work here (see `PushPort.platform`);
 * - `denied`: the user turned notifications off in the system settings;
 * - `registered`: the token of this device was accepted by the server during this sign-in;
 * - `failed`: permission granted, but no valid token could be obtained.
 */
export type PushRegistration = 'unavailable' | 'denied' | 'registered' | 'failed';

/**
 * Asks for permission when needed, reads the token and registers it (`POST me/push-tokens`; the
 * owner is the session's user). Resolves to `null` when the user has not decided (prompt
 * dismissed). API failures reject with the `ApiError`.
 */
export async function registerDevice(
  port: PushPort,
  profile: Pick<ProfileApi, 'registerPushToken'>,
): Promise<PushRegistration | null> {
  if (port.platform === null) {
    return 'unavailable';
  }
  const permission = await port.requestPermission();
  if (permission === 'denied') {
    return 'denied';
  }
  if (permission === 'undetermined') {
    return null;
  }
  let token: string;
  try {
    token = await port.expoToken();
  } catch {
    return 'failed';
  }
  if (!isExpoPushToken(token)) {
    return 'failed';
  }
  const body: RegisterPushTokenRequest = { expoToken: token, platform: port.platform };
  await profile.registerPushToken(body);
  return 'registered';
}

export interface PushState {
  /** Whether this device's token was registered in the current sign-in. Memory only. */
  readonly registered: boolean;
}

/**
 * Registration state of this sign-in. Not persisted (the server drops push tokens when the
 * account is deleted, and another account may sign in next); reset at every sign-out.
 */
export function createPushStore() {
  return createStore<PushState>()(() => ({ registered: false }));
}

export type PushStore = ReturnType<typeof createPushStore>;
