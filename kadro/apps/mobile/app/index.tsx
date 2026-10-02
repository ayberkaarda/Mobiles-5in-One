import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useStore } from 'zustand';

import { FormError, ProviderButtons } from '../src/auth/components';
import { providerSignIn } from '../src/auth/instance';
import { useAsyncAction } from '../src/auth/use-async-action';
import { pendingLink } from '../src/links/instance';
import { DELETION_GRACE_DAYS } from '../src/settings/deletion';
import { deletionNotice } from '../src/settings/notice';
import { useTheme } from '../src/theme';
import { Button, Card, Screen, Text } from '../src/ui';

/** Signed-out entry: the brand line and the way into sign-in or registration. */
export default function WelcomeScreen() {
  const { t } = useTranslation('auth');
  const theme = useTheme();
  const router = useRouter();
  const action = useAsyncAction();
  // Fallback when the grace screen did not survive the sign-out after a deletion request.
  const deletionPending = useStore(deletionNotice, (state) => state.pending);
  // An invite link opened while signed out; it opens after sign-in (ADR-0075).
  const invitePending = useStore(pendingLink, (state) => state.target?.kind === 'teamInvite');
  return (
    <Screen scroll testID="welcome-screen">
      <View style={{ paddingHorizontal: theme.spacing['6'], paddingTop: theme.spacing['10'] }}>
        <Text variant="display" accessibilityRole="header">
          {t('welcome.title')}
        </Text>
        <Text variant="title3" tone="muted" style={{ marginTop: theme.spacing['3'] }}>
          {t('welcome.subtitle')}
        </Text>
        {deletionPending ? (
          <Card style={{ marginTop: theme.spacing['6'] }} testID="welcome-deletion-pending">
            <Text accessibilityRole="alert">
              {t('common:deletion.doneMessage', { days: DELETION_GRACE_DAYS })}
            </Text>
            <Text tone="muted" style={{ marginTop: theme.spacing['2'] }}>
              {t('common:deletion.doneCancel', { days: DELETION_GRACE_DAYS })}
            </Text>
          </Card>
        ) : null}
        {invitePending ? (
          <Card style={{ marginTop: theme.spacing['6'] }} testID="welcome-invite-pending">
            <Text accessibilityLiveRegion="polite">{t('welcome.invitePending')}</Text>
          </Card>
        ) : null}
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
