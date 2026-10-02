import { createElement } from 'react';

/**
 * Test double of `expo-image` (loaded per test file with `vi.mock('expo-image', ...)`): a host
 * element that keeps the props, so a test can read the source and the spoken label.
 */
export function Image(props: Record<string, unknown>) {
  return createElement('Image', props);
}
