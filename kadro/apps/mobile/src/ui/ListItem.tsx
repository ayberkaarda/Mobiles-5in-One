import { type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';
import { Text } from './Text';

export interface ListItemProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Right-aligned value such as a time, a count or a fee; rendered with tabular digits. */
  readonly meta?: string;
  /** Element before the text (badge, avatar). Decorative: hidden from screen readers. */
  readonly leading?: ReactNode;
  /** Makes the row a button; without it the row is plain text. */
  readonly onPress?: () => void;
  readonly accessibilityHint?: string;
  readonly testID?: string;
}

/** One row of a list: at least 44 pt tall, announced as a single element with all its text. */
export function ListItem({
  title,
  subtitle,
  meta,
  leading,
  onPress,
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
    </>
  );
  const rowStyle = {
    minHeight: theme.minTouchTarget,
    paddingHorizontal: theme.spacing['4'],
    paddingVertical: theme.spacing['3'],
    backgroundColor: theme.colors.surface,
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
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        rowStyle,
        pressed ? { backgroundColor: theme.colors.pressed } : null,
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
