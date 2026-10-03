import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { type ColorRole, useTheme } from '../theme';
import { Text } from './Text';

/**
 * `sample`: the ÖRNEK tag (`warning` fill, `onWarning` label), beside the title it qualifies.
 * `verified`: no fill, a `primaryText` check and the word ("Doğrulanmış").
 * `neutral`: `fillMuted` with `text`. `inverse`: `inverse` with `onInverse`.
 * `positive` / `warning` / `negative`: state fills (`primary` / `warning` / `danger`) with their
 * on-colours ("Geliyorum" / "Belki" / "Gelmiyorum").
 */
export type BadgeTone =
  'sample' | 'verified' | 'neutral' | 'inverse' | 'positive' | 'warning' | 'negative';

export interface BadgeProps {
  readonly label: string;
  readonly tone?: BadgeTone;
  readonly testID?: string;
}

const FILL: Readonly<Record<Exclude<BadgeTone, 'verified'>, [ColorRole, ColorRole]>> = {
  sample: ['warning', 'onWarning'],
  neutral: ['fillMuted', 'text'],
  inverse: ['inverse', 'onInverse'],
  positive: ['primary', 'onPrimary'],
  warning: ['warning', 'onWarning'],
  negative: ['danger', 'onDanger'],
};

/** Small static tag (radius 4, caption type). Not interactive; use `Chip` for a choice. */
export function Badge({ label, tone = 'neutral', testID }: BadgeProps) {
  const theme = useTheme();
  if (tone === 'verified') {
    return (
      <View
        testID={testID}
        accessible
        accessibilityLabel={label}
        style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' }}
      >
        <Svg
          width={16}
          height={16}
          viewBox="0 0 24 24"
          style={{ marginRight: theme.spacing['1'] }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Path
            d="M5 12.5l4.5 4.5L19 7.5"
            stroke={theme.colors.primaryText}
            strokeWidth={2.5}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Text variant="caption" tone="primary">
          {label}
        </Text>
      </View>
    );
  }
  // eslint-disable-next-line security/detect-object-injection -- tone is a typed BadgeTone
  const [fill, on] = FILL[tone];
  return (
    <View
      testID={testID}
      accessible
      accessibilityLabel={label}
      style={{
        alignSelf: 'flex-start',
        paddingHorizontal: theme.spacing['2'],
        paddingVertical: 2,
        borderRadius: theme.radius.xs,
        // eslint-disable-next-line security/detect-object-injection -- fill is a typed ColorRole
        backgroundColor: theme.colors[fill],
      }}
    >
      {/* eslint-disable-next-line security/detect-object-injection -- on is a typed ColorRole */}
      <Text variant="caption" style={{ color: theme.colors[on] }}>
        {label}
      </Text>
    </View>
  );
}
