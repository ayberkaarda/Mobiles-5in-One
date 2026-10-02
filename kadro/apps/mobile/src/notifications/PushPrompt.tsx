import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormError } from '../auth/components';
import { useAsyncAction } from '../auth/use-async-action';
import { profileApi } from '../profile/instance';
import { pushPort, pushStore } from '../settings/push-instance';
import { registerDevice } from '../settings/push';
import { useTheme } from '../theme';
import { Button, Card, Text } from '../ui';
import { dismissPrompt, promptDismissed, shouldShowPrompt } from './prompt';

/**
 * Notification card on the matches tab: says what Kadro sends (reminders, lineup changes,
 * applications; never other players' names) before the system prompt, which starts only on the
 * "turn on" tap (ADR-0054, ADR-0075). "Not now" hides it on this device; the settings keep the
 * same action.
 */
export function PushPrompt() {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const action = useAsyncAction();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (pushPort.platform === null) {
      return;
    }
    let active = true;
    void Promise.all([pushPort.permission(), promptDismissed(AsyncStorage)])
      .then(([permission, dismissed]) => {
        if (active) {
          setVisible(shouldShowPrompt(true, permission, dismissed));
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  if (!visible) {
    return null;
  }

  const enable = (): void => {
    void action.run(async () => {
      const outcome = await registerDevice(pushPort, profileApi);
      if (outcome === 'registered') {
        pushStore.setState({ registered: true });
      }
      // A refusal is final for the system prompt; a dismissed prompt can be asked again.
      if (outcome !== null) {
        setVisible(false);
      }
    });
  };

  const later = (): void => {
    setVisible(false);
    void dismissPrompt(AsyncStorage);
  };

  return (
    <View
      style={{ paddingHorizontal: theme.spacing['4'], paddingBottom: theme.spacing['3'] }}
      testID="push-prompt"
    >
      <Card>
        <Text variant="title3" accessibilityRole="header">
          {t('pushPrompt.title')}
        </Text>
        <Text tone="muted" style={{ marginTop: theme.spacing['2'] }}>
          {t('pushPrompt.message')}
        </Text>
        <FormError error={action.error} />
        <View style={{ marginTop: theme.spacing['3'], gap: theme.spacing['2'] }}>
          <Button
            label={t('pushPrompt.enable')}
            loading={action.busy}
            onPress={enable}
            testID="push-prompt-enable"
          />
          <Button
            label={t('pushPrompt.later')}
            variant="secondary"
            onPress={later}
            testID="push-prompt-later"
          />
        </View>
      </Card>
    </View>
  );
}
