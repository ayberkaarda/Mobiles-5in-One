import { StyleSheet, View } from 'react-native';

import { useTheme } from '../theme';
import { Button } from './Button';
import { type StateAction } from './EmptyState';
import { Text } from './Text';

export interface ErrorStateProps {
  readonly title: string;
  /** Localized copy for the failure (from the `errors` namespace); never raw server text. */
  readonly message: string;
  readonly retry?: StateAction;
  /** Request id of the failed call, shown small so support can correlate it with server logs. */
  readonly requestId?: string;
  readonly referenceLabel?: string;
  readonly testID?: string;
}

/** The message is an alert, so screen readers read the failure without moving focus. */
export function ErrorState({
  title,
  message,
  retry,
  requestId,
  referenceLabel,
  testID,
}: ErrorStateProps) {
  const theme = useTheme();
  return (
    <View testID={testID} style={[styles.container, { padding: theme.spacing['6'] }]}>
      <Text variant="title3" align="center">
        {title}
      </Text>
      <Text
        tone="muted"
        align="center"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        style={{ marginTop: theme.spacing['2'] }}
      >
        {message}
      </Text>
      {requestId === undefined || referenceLabel === undefined ? null : (
        <Text
          variant="caption"
          tone="muted"
          align="center"
          selectable
          style={{ marginTop: theme.spacing['3'] }}
        >
          {`${referenceLabel}: ${requestId}`}
        </Text>
      )}
      {retry === undefined ? null : (
        <Button
          label={retry.label}
          onPress={retry.onPress}
          variant="secondary"
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
