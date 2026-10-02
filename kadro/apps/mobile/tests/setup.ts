import Module, { createRequire } from 'node:module';

import { afterAll, afterEach, beforeAll, expect } from 'vitest';

import { resetAsyncStorage, takeAsyncStorageViolations } from './support/async-storage';
import { resetSecureStore } from './support/expo-secure-store';
import { resetAppleDouble } from './support/expo-apple-authentication';
import { __setLinkingURL } from './support/expo-linking';
import { resetRouterDouble } from './support/expo-router';
import { mswServer } from './support/msw';
import * as reactNativeDouble from './support/react-native';

/**
 * Libraries loaded by Node's own `require` (React Native Testing Library) bypass the Vite alias.
 * Seeding Node's module cache with the test double makes their `require('react-native')` return
 * the same module the application code imports.
 */
function seedReactNativeForRequire(): void {
  const requireHere = createRequire(import.meta.url);
  const testingLibraryEntry = requireHere.resolve('@testing-library/react-native/pure');
  const reactNativePath = createRequire(testingLibraryEntry).resolve('react-native');
  const cached = new Module(reactNativePath);
  cached.filename = reactNativePath;
  cached.loaded = true;
  cached.exports = reactNativeDouble;
  // eslint-disable-next-line security/detect-object-injection -- path resolved by Node, not input
  requireHere.cache[reactNativePath] = cached;
}

seedReactNativeForRequire();

// React Native globals the libraries read at module load.
Object.assign(globalThis, { __DEV__: false, IS_REACT_ACT_ENVIRONMENT: true });

beforeAll(() => {
  // Any request without a handler fails the test: no test may reach a real network.
  mswServer.listen({ onUnhandledRequest: 'error' });
});

afterEach(async () => {
  // Unmount whatever a component test rendered (the `pure` entry has no automatic cleanup).
  const { cleanup } = await import('@testing-library/react-native/pure');
  await cleanup();
  mswServer.resetHandlers();
  resetSecureStore();
  resetRouterDouble();
  resetAppleDouble();
  __setLinkingURL(null);
  const violations = takeAsyncStorageViolations();
  resetAsyncStorage();
  // Threat model T-MOB-01: a credential written to AsyncStorage fails the test that wrote it.
  expect(violations, 'credential written to AsyncStorage').toEqual([]);
});

afterAll(() => {
  mswServer.close();
});
