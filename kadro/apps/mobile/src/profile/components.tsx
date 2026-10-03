import { Image } from 'expo-image';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '../api/errors';
import { errorMessage } from '../i18n/error-copy';
import { BackLink } from '../navigation/BackLink';
import { Fact } from '../matches/components';
import { useTheme } from '../theme';
import { Button, Numeral, Screen, SkeletonList, Text } from '../ui';
import { type Level, type MeStatsResponse, type Position } from './contracts';
import { initialsOf } from './initials';

/** Where "back" leads from the profile and settings screens opened directly (deep link, cold start). */
export const PROFILE_HOME = '/profil';

/** Page frame of a pushed profile or settings screen: back control, heading, scrolling content. */
export function ProfileScreen({
  title,
  home = PROFILE_HOME,
  children,
  testID,
}: {
  readonly title: string;
  readonly home?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  return (
    <Screen scroll testID={testID}>
      <BackLink label={t('nav.back')} fallback={home} />
      <Text
        variant="title1"
        style={{ paddingHorizontal: theme.spacing['4'], paddingBottom: theme.spacing['3'] }}
      >
        {title}
      </Text>
      {children}
    </Screen>
  );
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Position / level names come from the open-call copy; "not set" is the profile's own. */
export function profilePositionLabel(t: Translate, notSet: string, value: Position | null): string {
  return value === null ? notSet : t(`position.${value}`);
}

export function profileLevelLabel(t: Translate, notSet: string, value: Level | null): string {
  return value === null ? notSet : t(`level.${value}`);
}

export { initialsOf };

const AVATAR_SIZE = 72;

/** Profile photo (cached by `expo-image`) or the initials on a coloured disc. */
export function Avatar({
  url,
  displayName,
}: {
  readonly url: string | null;
  readonly displayName: string;
}) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  const frame = {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  };
  if (url !== null) {
    return (
      <Image
        source={{ uri: url }}
        style={frame}
        contentFit="cover"
        accessible
        accessibilityLabel={t('profile.avatarOf', { name: displayName })}
        testID="avatar-image"
      />
    );
  }
  return (
    <View
      accessible
      accessibilityLabel={t('profile.avatarOf', { name: displayName })}
      testID="avatar-initials"
      style={[
        frame,
        {
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: theme.colors.inverse,
        },
      ]}
    >
      <Text variant="bib" accessibilityRole="text" style={{ color: theme.colors.onInverse }}>
        {initialsOf(displayName)}
      </Text>
    </View>
  );
}

/** One statistic as a kit numeral over its label, read as "label: value". */
function StatNumeral({
  label,
  value,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly testID: string;
}) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} testID={testID}>
      <Numeral value={value} variant="score" />
      <Text variant="footnote" tone="muted">
        {label}
      </Text>
    </View>
  );
}

function percent(rate: number | null, language: string): string | null {
  if (rate === null) {
    return null;
  }
  return new Intl.NumberFormat(language === 'en' ? 'en-GB' : 'tr-TR', {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(rate);
}

/**
 * Statistics from `GET me/stats`: matches played and MVP count for everyone, the advanced block
 * when the server answered with the full tier (Pro). A failure stays inside this card with its
 * own retry, so the rest of the profile is still usable.
 */
export function StatsCard({
  status,
  data,
  error,
  onRetry,
}: {
  readonly status: 'pending' | 'error' | 'success';
  readonly data: MeStatsResponse | undefined;
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const { t, i18n } = useTranslation('common');
  const theme = useTheme();
  let body;
  if (data !== undefined) {
    body = (
      <View style={{ gap: theme.spacing['3'] }}>
        <View style={{ flexDirection: 'row', gap: theme.spacing['6'] }}>
          <StatNumeral
            label={t('stats.matchesPlayed')}
            value={String(data.matchesPlayed)}
            testID="stats-played"
          />
          <StatNumeral
            label={t('stats.mvpCount')}
            value={String(data.mvpCount)}
            testID="stats-mvp"
          />
        </View>
        {data.tier === 'full' ? (
          <>
            <Fact
              label={t('stats.last30Days')}
              value={String(data.advanced.matchesPlayedLast30Days)}
              testID="stats-last30"
            />
            <Fact
              label={t('stats.mvpRate')}
              value={percent(data.advanced.mvpRate, i18n.language) ?? t('stats.noValue')}
            />
            <Fact
              label={t('stats.attendanceRate')}
              value={percent(data.advanced.attendanceRate, i18n.language) ?? t('stats.noValue')}
            />
            <Fact label={t('stats.venues')} value={String(data.advanced.distinctVenues)} />
            <Fact label={t('stats.teams')} value={String(data.advanced.distinctTeams)} />
          </>
        ) : null}
      </View>
    );
  } else if (status === 'error') {
    const requestId = error instanceof ApiError ? error.requestId : null;
    body = (
      <View testID="stats-error">
        <Text tone="muted" accessibilityLiveRegion="polite">
          {`${t('stats.loadFailed')} ${errorMessage(i18n, error)}`}
        </Text>
        {requestId === null ? null : (
          <Text variant="caption" tone="muted" selectable style={{ marginTop: theme.spacing['1'] }}>
            {`${t('state.reference')}: ${requestId}`}
          </Text>
        )}
        <Button
          label={t('state.retry')}
          variant="secondary"
          onPress={onRetry}
          testID="stats-retry"
          style={{ marginTop: theme.spacing['3'] }}
        />
      </View>
    );
  } else {
    body = <SkeletonList accessibilityLabel={t('state.loading')} rows={2} testID="stats-loading" />;
  }
  return (
    <View testID="stats-card">
      <Text
        variant="title3"
        accessibilityRole="header"
        style={{ marginBottom: theme.spacing['3'] }}
      >
        {t('stats.title')}
      </Text>
      {body}
    </View>
  );
}
