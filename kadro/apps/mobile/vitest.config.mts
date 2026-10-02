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
      { find: /^@shopify\/flash-list$/, replacement: support('flash-list.tsx') },
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
