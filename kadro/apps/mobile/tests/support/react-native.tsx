/**
 * Test double of the `react-native` module for component tests under Vitest.
 *
 * The real package ships Flow sources and native bindings that do not load in Node. This module
 * renders the same host component names React Native renders (`View`, `Text`, `TextInput`,
 * `RCTScrollView`, ...), so React Native Testing Library queries, accessibility props and press
 * handling behave as on a device. Only the APIs the app and the testing library use are present.
 */
import {
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
  useSyncExternalStore,
} from 'react';

type Props = Record<string, unknown> & { children?: ReactNode };

function host(name: string) {
  function HostComponent(props: Props) {
    return createElement(name, props);
  }
  HostComponent.displayName = name;
  return HostComponent;
}

export const View = host('View');
export const Text = host('Text');
export const TextInput = host('TextInput');
export const Image = host('Image');
export const ActivityIndicator = host('ActivityIndicator');
export const RefreshControl = host('RefreshControl');
export const Modal = host('Modal');
export const KeyboardAvoidingView = host('View');

export function ScrollView({ children, contentContainerStyle, ...props }: Props) {
  return createElement(
    'RCTScrollView',
    props,
    createElement('View', { style: contentContainerStyle }, children),
  );
}

interface PressableProps extends Omit<Props, 'children'> {
  style?: unknown;
  children?: ReactNode | ((state: { pressed: boolean }) => ReactNode);
  disabled?: boolean | null;
}

export function Pressable({ style, children, disabled, ...props }: PressableProps) {
  const state = { pressed: false };
  const resolvedStyle =
    typeof style === 'function' ? (style as (s: typeof state) => unknown)(state) : style;
  const resolvedChildren = typeof children === 'function' ? children(state) : children;
  return createElement(
    'View',
    {
      ...props,
      accessible: props.accessible ?? true,
      style: resolvedStyle,
      // As in React Native, a disabled Pressable refuses to become the touch responder.
      onStartShouldSetResponder: () => disabled !== true,
    },
    resolvedChildren,
  );
}

interface FlatListProps<T> extends Props {
  data?: readonly T[] | null;
  renderItem: (info: { item: T; index: number }) => ReactElement | null;
  keyExtractor?: (item: T, index: number) => string;
  ListEmptyComponent?: ReactElement | (() => ReactElement) | null;
  ListHeaderComponent?: ReactElement | (() => ReactElement) | null;
  ListFooterComponent?: ReactElement | (() => ReactElement) | null;
}

function renderSlot(slot: ReactElement | (() => ReactElement) | null | undefined): ReactNode {
  if (slot === null || slot === undefined) {
    return null;
  }
  return typeof slot === 'function' ? createElement(slot) : slot;
}

export function FlatList<T>({
  data,
  renderItem,
  keyExtractor,
  ListEmptyComponent,
  ListHeaderComponent,
  ListFooterComponent,
  ...props
}: FlatListProps<T>) {
  const items = data ?? [];
  return createElement(
    'RCTScrollView',
    props,
    renderSlot(ListHeaderComponent),
    items.length === 0
      ? renderSlot(ListEmptyComponent)
      : items.map((item, index) =>
          createElement(
            Fragment,
            { key: keyExtractor?.(item, index) ?? String(index) },
            renderItem({ item, index }),
          ),
        ),
    renderSlot(ListFooterComponent),
  );
}

type StyleValue = Record<string, unknown> | StyleValue[] | null | undefined | false;

function flatten(style: StyleValue): Record<string, unknown> {
  if (style === null || style === undefined || style === false) {
    return {};
  }
  if (Array.isArray(style)) {
    return style.reduce<Record<string, unknown>>(
      (merged, entry) => Object.assign(merged, flatten(entry)),
      {},
    );
  }
  return { ...style };
}

export const StyleSheet = {
  create<T>(styles: T): T {
    return styles;
  },
  flatten,
  compose(a: StyleValue, b: StyleValue): StyleValue {
    return [a, b];
  },
  hairlineWidth: 1,
  absoluteFill: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
  absoluteFillObject: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 },
};

export const Platform = {
  OS: 'ios' as const,
  Version: '18.0',
  select<T>(options: { ios?: T; android?: T; native?: T; default?: T }): T | undefined {
    return options.ios ?? options.native ?? options.default;
  },
};

type ColorScheme = 'light' | 'dark' | null;
let colorScheme: ColorScheme = 'light';
const colorSchemeListeners = new Set<() => void>();

/** Test hook: switches the simulated system appearance. */
export function __setColorScheme(next: ColorScheme): void {
  colorScheme = next;
  for (const listener of colorSchemeListeners) {
    listener();
  }
}

export const Appearance = {
  getColorScheme: (): ColorScheme => colorScheme,
  addChangeListener(listener: () => void) {
    colorSchemeListeners.add(listener);
    return { remove: () => colorSchemeListeners.delete(listener) };
  },
};

export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(
    (listener) => {
      colorSchemeListeners.add(listener);
      return () => colorSchemeListeners.delete(listener);
    },
    () => colorScheme,
  );
}

type AppStateStatus = 'active' | 'background' | 'inactive';
const appStateListeners = new Set<(state: AppStateStatus) => void>();

export const AppState = {
  currentState: 'active' as AppStateStatus,
  addEventListener(_type: 'change', listener: (state: AppStateStatus) => void) {
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  },
};

/** Test hook: simulates the app moving to the foreground or background. */
export function __setAppState(next: AppStateStatus): void {
  AppState.currentState = next;
  for (const listener of appStateListeners) {
    listener(next);
  }
}

export const AccessibilityInfo = {
  isReduceMotionEnabled: async () => false,
  isScreenReaderEnabled: async () => false,
  announceForAccessibility: () => undefined,
  addEventListener: () => ({ remove: () => undefined }),
};

export const I18nManager = { isRTL: false, allowRTL: () => undefined, forceRTL: () => undefined };

export interface ShareContent {
  readonly message?: string;
  readonly url?: string;
  readonly title?: string;
}

let sharedContent: ShareContent[] = [];
let shareFailure: Error | null = null;

/** Records what would open in the system share sheet. */
export const Share = {
  sharedAction: 'sharedAction' as const,
  dismissedAction: 'dismissedAction' as const,
  async share(content: ShareContent): Promise<{ action: 'sharedAction' }> {
    if (shareFailure !== null) {
      throw shareFailure;
    }
    sharedContent.push(content);
    return { action: 'sharedAction' };
  },
};

/** Test hook: what was handed to the share sheet since the last reset. */
export function __sharedContent(): readonly ShareContent[] {
  return sharedContent;
}

/** Test hook: makes the next share calls fail like a share sheet that cannot open. */
export function __setShareFailure(next: Error | null): void {
  shareFailure = next;
}

export function __resetShare(): void {
  sharedContent = [];
  shareFailure = null;
}
