import { Pressable, View } from 'react-native';

import { pitchDiagram, useTheme } from '../theme';
import { Text } from './Text';

export interface ChipProps {
  readonly label: string;
  /** Selected chips use `inverse` with `onInverse`; at rest `fillMuted` with `text`. */
  readonly selected?: boolean;
  /** Without it the chip is a static label (position, level, facility). */
  readonly onPress?: () => void;
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

/** The chip height of the brand (`pitchDiagram.benchChipHeight`, 32 pt). */
const CHIP_HEIGHT = pitchDiagram.benchChipHeight;

/** Chip for filters and attributes: radius 4, 32 pt high (44 pt touch area when pressable). */
export function Chip({
  label,
  selected = false,
  onPress,
  disabled = false,
  accessibilityHint,
  testID,
}: ChipProps) {
  const theme = useTheme();
  const fill = selected ? theme.colors.inverse : theme.colors.fillMuted;
  const color = selected ? theme.colors.onInverse : theme.colors.text;
  const chipStyle = {
    minHeight: CHIP_HEIGHT,
    justifyContent: 'center' as const,
    alignSelf: 'flex-start' as const,
    paddingHorizontal: theme.spacing['3'],
    borderRadius: theme.radius.xs,
    backgroundColor: fill,
  };
  const content = (
    <Text variant="label" style={{ color }}>
      {label}
    </Text>
  );
  if (onPress === undefined) {
    return (
      <View accessible accessibilityLabel={label} testID={testID} style={chipStyle}>
        {content}
      </View>
    );
  }
  const slop = Math.max(0, (theme.minTouchTarget - CHIP_HEIGHT) / 2);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={{ top: slop, bottom: slop }}
      testID={testID}
      style={({ pressed }) => [
        chipStyle,
        disabled ? { opacity: 0.5 } : null,
        pressed && !disabled ? { opacity: 0.85 } : null,
      ]}
    >
      {content}
    </Pressable>
  );
}
