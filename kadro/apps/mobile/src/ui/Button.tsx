import {
  ActivityIndicator,
  Pressable,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

import { type Theme, useTheme } from '../theme';
import { Text } from './Text';

/**
 * `primary`: the main action (green fill). `accent`: the one orange action per viewport.
 * `secondary`: surface with a `borderStrong` outline. `danger`: destructive.
 */
export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'danger';

export interface ButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  /** Shows a spinner, marks the button busy and ignores presses. */
  readonly loading?: boolean;
  /** Overrides the spoken name when the visible label is not enough. */
  readonly accessibilityLabel?: string;
  readonly accessibilityHint?: string;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}

interface VariantColors {
  readonly background: string;
  readonly foreground: string;
  readonly border: string;
}

export function buttonColors(theme: Theme, variant: ButtonVariant): VariantColors {
  const { colors } = theme;
  switch (variant) {
    case 'primary':
      return { background: colors.primary, foreground: colors.onPrimary, border: colors.primary };
    case 'accent':
      return { background: colors.accent, foreground: colors.onAccent, border: colors.accent };
    case 'danger':
      return { background: colors.danger, foreground: colors.onDanger, border: colors.danger };
    case 'secondary':
      return { background: colors.surface, foreground: colors.text, border: colors.borderStrong };
  }
}

/** 48 pt high, radius 8, label weight 600. Disabled sits on `fillMuted`. */
export function Button({
  label,
  onPress,
  variant = 'primary',
  disabled = false,
  loading = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const theme = useTheme();
  const active = buttonColors(theme, variant);
  const palette: VariantColors = disabled
    ? {
        background: theme.colors.fillMuted,
        foreground: theme.colors.textMuted,
        border: theme.colors.fillMuted,
      }
    : active;
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: theme.layout.controlHeight,
          paddingHorizontal: theme.spacing['5'],
          paddingVertical: theme.spacing['3'],
          borderRadius: theme.radius.sm,
          backgroundColor: palette.background,
          borderColor: palette.border,
        },
        style,
        pressed && !inactive ? { opacity: 0.85 } : null,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator
            color={palette.foreground}
            style={{ marginRight: theme.spacing['2'] }}
          />
        ) : null}
        <Text variant="label" style={{ color: palette.foreground }} align="center">
          {label}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
