import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';
import { useStore } from 'zustand';

import { useAuthStatus } from '../../src/auth-store';
import { formatDateTime } from '../../src/i18n/format';
import { DELETION_GRACE_DAYS, NO_DELETION_NOTICE } from '../../src/settings/deletion';
import { deletionNotice } from '../../src/settings/notice';
import { useTheme } from '../../src/theme';
import { Button, Card, Screen, Text } from '../../src/ui';

/**
 * After "Hesabımı sil": the account is closed and this device is signed out. Explains the 7-day
 * grace period and that signing in again cancels the deletion (ADR-0012). Registered outside
 * both route guards, so the sign-out that follows the request does not close it; the date lives
 * in memory only, a cold start or a link here shows the explanation without it.
 */
export default function DeletionNoticeScreen() {
  const { t, i18n } = useTranslation('common');
  const theme = useTheme();
  const router = useRouter();
  const status = useAuthStatus();
  const { pending, graceUntil } = useStore(deletionNotice);
  // Opened by a link while signed in, without a request on this device: nothing to explain.
  const stray = status === 'signedIn' && !pending;

  useEffect(() => {
    if (stray) {
      router.replace('/profil');
    }
  }, [stray, router]);

  if (stray) {
    return (
      <Screen title={t('deletion.noRequestTitle')} testID="deletion-done-stray">
        <View style={{ paddingHorizontal: theme.spacing['4'] }}>
          <Text tone="muted">{t('deletion.noRequest')}</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen title={t('deletion.doneTitle')} scroll testID="deletion-done-screen">
      <View style={{ paddingHorizontal: theme.spacing['4'], gap: theme.spacing['3'] }}>
        <Card>
          <Text accessibilityRole="alert" accessibilityLiveRegion="polite">
            {graceUntil === null
              ? t('deletion.doneMessage', { days: DELETION_GRACE_DAYS })
              : t('deletion.doneMessageUntil', {
                  date: formatDateTime(graceUntil, i18n.language),
                })}
          </Text>
        </Card>
        <Text tone="muted">{t('deletion.doneCancel', { days: DELETION_GRACE_DAYS })}</Text>
        <Text tone="muted">{t('deletion.doneEmail')}</Text>
        <Button
          label={status === 'signedIn' ? t('deletion.doneHome') : t('deletion.doneSignIn')}
          variant="secondary"
          onPress={() => {
            deletionNotice.setState(NO_DELETION_NOTICE);
            router.replace(status === 'signedIn' ? '/profil' : '/');
          }}
          testID="deletion-done-continue"
        />
      </View>
    </Screen>
  );
}
