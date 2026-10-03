import { View } from 'react-native';

import { useTheme } from '../theme';
import { Text } from './Text';

export interface KitNumberProps {
  /** The player's kit number. */
  readonly number: number | string;
  /** Circle diameter in points (32 in participant rows). */
  readonly size?: number;
  readonly testID?: string;
}

/**
 * A kit number in a filled circle (participant rows): `text` fill with the number in
 * `background`, so it inverts with the scheme. Decorative next to the player name; give the row
 * the spoken text.
 */
export function KitNumber({ number, size = 32, testID }: KitNumberProps) {
  const theme = useTheme();
  const type = theme.typography.bib;
  const fontSize = Math.round(size / 2);
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.full,
        backgroundColor: theme.colors.text,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        variant="bib"
        allowFontScaling={false}
        style={{
          color: theme.colors.background,
          fontSize,
          lineHeight: Math.round(fontSize * (type.lineHeight / type.fontSize)),
        }}
      >
        {String(number)}
      </Text>
    </View>
  );
}
