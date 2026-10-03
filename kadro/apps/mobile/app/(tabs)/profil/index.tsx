import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../../../src/api/instance';
import { ProUpsell } from '../../../src/billing/components';
import { isPro } from '../../../src/billing/hooks';
import { callsApi } from '../../../src/calls/instance';
import { districtLabel } from '../../../src/calls/form';
import { districtsQuery } from '../../../src/calls/queries';
import { Fact } from '../../../src/matches/components';
import {
  Avatar,
  profileLevelLabel,
  profilePositionLabel,
  StatsCard,
} from '../../../src/profile/components';
import { profileApi } from '../../../src/profile/instance';
import { statsQuery } from '../../../src/profile/queries';
import { meQuery, QueryBoundary } from '../../../src/query';
import { CachedNotice, ResourceState } from '../../../src/teams/components';
import { useTheme } from '../../../src/theme';
import { Badge, Button, Screen, Text } from '../../../src/ui';

/**
 * Own profile (`GET /api/v1/me`): photo, name, position, level, district and the statistics
 * (`GET /api/v1/me/stats`), with the way to edit it and to the settings.
 */
export default function ProfileTab() {
  const { t } = useTranslation('common');
  const { t: tc } = useTranslation('opencalls');
  const theme = useTheme();
  const router = useRouter();
  const me = useQuery(meQuery(api));
  const stats = useQuery(statsQuery(profileApi));
  const hasDistrict = me.data !== undefined && me.data.districtId !== null;
  const districts = useQuery({ ...districtsQuery(callsApi), enabled: hasDistrict });

  const settingsButton = (
    <View style={{ padding: theme.spacing['4'] }}>
      <Button
        label={t('profile.settings')}
        variant="secondary"
        onPress={() => router.push('/ayarlar')}
        testID="profile-settings"
      />
    </View>
  );

  if (me.data === undefined) {
    return (
      <Screen title={t('tabs.profile')} scroll testID="profile-screen">
        <QueryBoundary>
          <ResourceState
            status={me.status === 'error' ? 'error' : 'pending'}
            error={me.error}
            onRetry={() => void me.refetch()}
            missingTitle={t('state.errorTitle')}
            missingMessage={t('error.unknown')}
            testID="profile"
          />
          {settingsButton}
        </QueryBoundary>
      </Screen>
    );
  }

  const profile = me.data;
  const notSet = t('profile.notSet');
  let district = notSet;
  if (profile.districtId !== null) {
    district =
      districtLabel(districts.data?.items ?? [], profile.districtId) ??
      (districts.status === 'pending' ? t('state.loading') : t('profile.districtUnavailable'));
  }

  return (
    <Screen title={t('tabs.profile')} scroll testID="profile-screen">
      <QueryBoundary>
        <CachedNotice visible={me.isRefetchError} />
        <View style={{ marginHorizontal: theme.spacing['4'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing['4'] }}>
            <Avatar url={profile.avatarUrl} displayName={profile.displayName} />
            <View style={{ flexShrink: 1 }}>
              <Text variant="title1">{profile.displayName}</Text>
              <Text selectable tone="muted" variant="footnote">
                {profile.email}
              </Text>
              {isPro(profile) ? (
                <View style={{ marginTop: theme.spacing['1'] }}>
                  <Badge label={t('profile.pro')} tone="inverse" testID="profile-pro" />
                </View>
              ) : null}
            </View>
          </View>
          {profile.emailVerified ? null : (
            <Text variant="footnote" tone="danger" style={{ marginTop: theme.spacing['3'] }}>
              {t('profile.emailUnverified')}
            </Text>
          )}
          <View style={{ marginTop: theme.spacing['4'], gap: theme.spacing['2'] }}>
            <Fact
              label={t('profile.position')}
              value={profilePositionLabel(tc, notSet, profile.position)}
              testID="profile-position"
            />
            <Fact
              label={t('profile.level')}
              value={profileLevelLabel(tc, notSet, profile.level)}
              testID="profile-level"
            />
            <Fact label={t('profile.district')} value={district} testID="profile-district" />
          </View>
          <Button
            label={t('profile.edit')}
            onPress={() => router.push('/profil/duzenle')}
            testID="profile-edit"
            style={{ marginTop: theme.spacing['4'] }}
          />
        </View>
        <View style={{ marginHorizontal: theme.spacing['4'], marginTop: theme.spacing['4'] }}>
          <StatsCard
            status={stats.status}
            data={stats.data}
            error={stats.error}
            onRetry={() => void stats.refetch()}
          />
        </View>
        {isPro(profile) ? null : (
          <View style={{ marginHorizontal: theme.spacing['4'], marginTop: theme.spacing['4'] }}>
            <ProUpsell message={t('paywall.statsLocked')} testID="profile-pro-upsell" />
          </View>
        )}
        {settingsButton}
      </QueryBoundary>
    </Screen>
  );
}
