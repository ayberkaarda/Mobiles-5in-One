/** Test double of `react-native-safe-area-context`: zero insets, plain views. */
import { createElement, type ReactNode } from 'react';

const ZERO_INSETS = { top: 0, right: 0, bottom: 0, left: 0 };

export type Edge = 'top' | 'right' | 'bottom' | 'left';

export function SafeAreaProvider({ children }: { children?: ReactNode }) {
  return createElement('View', { style: { flex: 1 } }, children);
}

export function SafeAreaView({
  children,
  edges: _edges,
  ...props
}: Record<string, unknown> & { children?: ReactNode }) {
  return createElement('View', props, children);
}

export function useSafeAreaInsets() {
  return ZERO_INSETS;
}

export const initialWindowMetrics = {
  insets: ZERO_INSETS,
  frame: { x: 0, y: 0, width: 390, height: 844 },
};
