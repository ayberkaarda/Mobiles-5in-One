import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { FormError, ProviderButtons } from '../src/auth/components';
import { providerSignIn } from '../src/auth/instance';
import { useAsyncAction } from '../src/auth/use-async-action';
import { useTheme } from '../src/theme';
import { Button, Screen, Text } from '../src/ui';

/** Signed-out entry: the brand line and the way into sign-in or registration. */
export default function WelcomeScreen() {
  const { t } = useTranslation('auth');
  const theme = useTheme();
  const router = useRouter();
  const action = useAsyncAction();
  return (
    <Screen scroll testID="welcome-screen">
      <View style={{ paddingHorizontal: theme.spacing['6'], paddingTop: theme.spacing['10'] }}>
        <Text variant="display" accessibilityRole="header">
          {t('welcome.title')}
        </Text>
        <Text variant="title3" tone="muted" style={{ marginTop: theme.spacing['3'] }}>
          {t('welcome.subtitle')}
        </Text>
        <View style={{ marginTop: theme.spacing['8'] }}>
          <Button
            label={t('welcome.signIn')}
            onPress={() => router.push('/giris')}
            testID="welcome-sign-in"
            style={{ marginBottom: theme.spacing['3'] }}
          />
          <Button
            label={t('welcome.signUp')}
            variant="secondary"
            onPress={() => router.push('/kayit')}
            testID="welcome-sign-up"
          />
          <FormError error={action.error} />
          <ProviderButtons providers={providerSignIn} action={action} />
        </View>
      </View>
    </Screen>
  );
}
