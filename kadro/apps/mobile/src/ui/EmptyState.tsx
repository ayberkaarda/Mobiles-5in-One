import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';
import { Button } from './Button';
import { EksikSlot } from './EksikSlot';
import { Text } from './Text';

export interface StateAction {
  readonly label: string;
  readonly onPress: () => void;
}

export interface EmptyStateProps {
  readonly title: string;
  readonly message: string;
  /** The one action that creates what is missing ("İlk maçı aç"). */
  readonly action?: StateAction;
  /** Shows the 64 pt eksik glyph above the title (default). */
  readonly glyph?: boolean;
  readonly testID?: string;
}

/** Shown when a list or screen has loaded and has nothing to show yet. */
export function EmptyState({ title, message, action, glyph = true, testID }: EmptyStateProps) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.container, { padding: theme.spacing['6'] }]}>
      {glyph ? (
        <View style={{ marginBottom: theme.spacing['4'] }}>
          <EksikSlot size={64} />
        </View>
      ) : null}
      <Text variant="title3" align="center">
        {title}
      </Text>
      <Text tone="muted" align="center" style={{ marginTop: theme.spacing['2'] }}>
        {message}
      </Text>
      {action === undefined ? null : (
        <Button
          label={action.label}
          onPress={action.onPress}
          style={{ marginTop: theme.spacing['5'], alignSelf: 'stretch' }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
