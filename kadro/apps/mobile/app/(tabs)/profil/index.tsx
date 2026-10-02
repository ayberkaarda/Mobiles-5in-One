import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '../../../src/api/errors';
import { api, session } from '../../../src/api/instance';
import { errorMessage } from '../../../src/i18n/error-copy';
import { meQuery, QueryBoundary } from '../../../src/query';
import { useTheme } from '../../../src/theme';
import { Button, Card, ErrorState, Screen, SkeletonList, Text } from '../../../src/ui';

/** Own profile (`GET /api/v1/me`) and sign-out; profile editing and settings come with the profile screens. */
export default function ProfileTab() {
  const { t, i18n } = useTranslation('common');
  const theme = useTheme();
  const query = useQuery(meQuery(api));
  const [signingOut, setSigningOut] = useState(false);

  const signOut = (): void => {
    setSigningOut(true);
    void session.signOut({ revokeRemote: true }).finally(() => setSigningOut(false));
  };

  let body;
  if (query.data !== undefined) {
    const me = query.data;
    body = (
      <Card style={{ marginHorizontal: theme.spacing['4'] }}>
        <Text variant="title3">{me.displayName}</Text>
        <Text variant="footnote" tone="muted" style={{ marginTop: theme.spacing['3'] }}>
          {t('profile.email')}
        </Text>
        <Text selectable>{me.email}</Text>
        {me.emailVerified ? null : (
          <Text variant="footnote" tone="danger" style={{ marginTop: theme.spacing['2'] }}>
            {t('profile.emailUnverified')}
          </Text>
        )}
      </Card>
    );
  } else if (query.status === 'error') {
    body = (
      <ErrorState
        title={t('state.errorTitle')}
        message={errorMessage(i18n, query.error)}
        requestId={
          query.error instanceof ApiError ? (query.error.requestId ?? undefined) : undefined
        }
        referenceLabel={t('state.reference')}
        retry={{ label: t('state.retry'), onPress: () => void query.refetch() }}
      />
    );
  } else {
    body = <SkeletonList accessibilityLabel={t('state.loading')} rows={2} />;
  }

  return (
    <Screen title={t('tabs.profile')} scroll>
      <QueryBoundary>
        {body}
        <View style={{ padding: theme.spacing['4'] }}>
          <Button
            label={t('profile.signOut')}
            accessibilityHint={t('profile.signOutHint')}
            variant="secondary"
            loading={signingOut}
            onPress={signOut}
          />
        </View>
      </QueryBoundary>
    </Screen>
  );
}
