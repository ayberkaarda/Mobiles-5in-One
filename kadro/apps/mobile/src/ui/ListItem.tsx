import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useTheme } from '../theme';
import { Text } from './Text';

export interface ListItemProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Right-aligned value such as a time, a count or a fee; rendered with tabular digits. */
  readonly meta?: string;
  /** Element before the text (kit number, avatar). Decorative: hidden from screen readers. */
  readonly leading?: ReactNode;
  /** Element after the text (chip, badge). Decorative: the row label already carries the text. */
  readonly trailing?: ReactNode;
  /** Shows a chevron; use it only when the row opens another screen. */
  readonly chevron?: boolean;
  /** Draws the 1 px `border` hairline under the row (lists that do not draw separators). */
  readonly divider?: boolean;
  /** Makes the row a button; without it the row is plain text. */
  readonly onPress?: () => void;
  /** A pressable row that is temporarily unavailable: announced as disabled, ignores presses. */
  readonly disabled?: boolean;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

/** One row of a list: at least 56 pt tall, announced as a single element with all its text. */
export function ListItem({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  chevron = false,
  divider = false,
  onPress,
  disabled = false,
  accessibilityHint,
  testID,
}: ListItemProps) {
  const theme = useTheme();
  const spokenLabel = [title, subtitle, meta].filter((part) => part !== undefined).join(', ');
  const content = (
    <>
      {leading === undefined ? null : (
        <View
          style={{ marginRight: theme.spacing['3'] }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {leading}
        </View>
      )}
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="footnote" tone="muted" numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {meta === undefined ? null : (
        <Text variant="label" tone="muted" tabular style={{ marginLeft: theme.spacing['3'] }}>
          {meta}
        </Text>
      )}
      {trailing === undefined ? null : (
        <View
          style={{ marginLeft: theme.spacing['3'] }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {trailing}
        </View>
      )}
      {chevron ? (
        <Svg
          width={20}
          height={20}
          viewBox="0 0 24 24"
          style={{ marginLeft: theme.spacing['2'] }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Path
            d="M9 5l7 7-7 7"
            stroke={theme.colors.textMuted}
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      ) : null}
    </>
  );
  const rowStyle = {
    minHeight: theme.layout.rowMinHeight,
    paddingHorizontal: theme.spacing['4'],
    paddingVertical: theme.spacing['3'],
    backgroundColor: theme.colors.surface,
    ...(divider ? { borderBottomWidth: 1, borderBottomColor: theme.colors.border } : {}),
  };

  if (onPress === undefined) {
    return (
      <View
        accessible
        accessibilityLabel={spokenLabel}
        testID={testID}
        style={[styles.row, rowStyle]}
      >
        {content}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spokenLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        rowStyle,
        disabled ? { opacity: 0.5 } : null,
        pressed && !disabled ? { backgroundColor: theme.colors.pressed } : null,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    flex: 1,
  },
});
