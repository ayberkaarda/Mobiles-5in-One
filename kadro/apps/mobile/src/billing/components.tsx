import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useTheme } from '../theme';
import { Button, Card, Text } from '../ui';

/** Route of the paywall screen. */
export const PAYWALL_ROUTE = '/kadro-pro';

/**
 * A Pro-only feature or limit with the way to the paywall. Callers show it only when the server
 * says the user has no Pro (`me.entitlements.pro`); Pro users never see an upsell.
 */
export function ProUpsell({
  message,
  testID,
}: {
  readonly message: string;
  readonly testID?: string;
}) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const router = useRouter();
  return (
    <Card testID={testID}>
      <Text variant="footnote" tone="muted">
        {message}
      </Text>
      <Button
        label={t('paywall.open')}
        variant="secondary"
        onPress={() => router.push(PAYWALL_ROUTE)}
        testID={testID && `${testID}-open`}
        style={{ marginTop: theme.spacing['3'] }}
      />
    </Card>
  );
}
