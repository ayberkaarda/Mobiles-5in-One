import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const support = (file: string): string =>
  fileURLToPath(new URL(`./tests/support/${file}`, import.meta.url));

/**
 * Vitest runs the build configuration tests and the component / module tests in Node. Native
 * modules are replaced by the test doubles in `tests/support`; the
 * application code under test is the real source.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-native$/, replacement: support('react-native.tsx') },
      { find: /^react-native-safe-area-context$/, replacement: support('safe-area-context.tsx') },
      { find: /^expo-secure-store$/, replacement: support('expo-secure-store.ts') },
      { find: /^expo-localization$/, replacement: support('expo-localization.ts') },
      { find: /^expo-router$/, replacement: support('expo-router.tsx') },
      { find: /^expo-linking$/, replacement: support('expo-linking.ts') },
      { find: /^expo-constants$/, replacement: support('expo-constants.ts') },
      { find: /^expo-notifications$/, replacement: support('expo-notifications.ts') },
      {
        find: /^expo-apple-authentication$/,
        replacement: support('expo-apple-authentication.ts'),
      },
      { find: /^@shopify\/flash-list$/, replacement: support('flash-list.tsx') },
      { find: /^react-native-qrcode-svg$/, replacement: support('qrcode-svg.tsx') },
      { find: /^react-native-svg$/, replacement: support('react-native-svg.tsx') },
      { find: /^react-native-purchases$/, replacement: support('react-native-purchases.ts') },
      {
        find: /^@react-native-async-storage\/async-storage$/,
        replacement: support('async-storage.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
  },
});
