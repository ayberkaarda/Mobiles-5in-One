import { type DimensionValue, View } from 'react-native';

import { useTheme } from '../theme';

export interface SkeletonBlockProps {
  readonly width?: DimensionValue;
  readonly height: number;
  readonly radius?: number;
}

/** Static placeholder block; it does not animate, so it needs no reduced-motion handling. */
export function SkeletonBlock({ width = '100%', height, radius }: SkeletonBlockProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        width,
        height,
        borderRadius: radius ?? theme.radius.sm,
        backgroundColor: theme.colors.skeleton,
      }}
    />
  );
}

export interface SkeletonListProps {
  /** Spoken while loading, e.g. "Yükleniyor". */
  readonly accessibilityLabel: string;
  readonly rows?: number;
  readonly testID?: string;
}

/**
 * Loading state of a list: rows shaped like `ListItem`. Screen readers hear one busy progress
 * element instead of the individual blocks.
 */
export function SkeletonList({ accessibilityLabel, rows = 6, testID }: SkeletonListProps) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ busy: true }}
      testID={testID}
    >
      {Array.from({ length: rows }, (_, index) => (
        <View
          key={index}
          style={{
            minHeight: theme.minTouchTarget + theme.spacing['4'],
            paddingHorizontal: theme.spacing['4'],
            paddingVertical: theme.spacing['3'],
            justifyContent: 'center',
          }}
        >
          <SkeletonBlock width="60%" height={16} />
          <View style={{ height: theme.spacing['2'] }} />
          <SkeletonBlock width="35%" height={12} />
        </View>
      ))}
    </View>
  );
}
