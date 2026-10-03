import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { type MatchSummary } from '../../../src/api/contracts';
import { api } from '../../../src/api/instance';
import { formatDateTime } from '../../../src/i18n/format';
import { matchHref, teamMatchesHref } from '../../../src/matches/components';
import { tabMatches } from '../../../src/matches/list';
import { PushPrompt } from '../../../src/notifications/PushPrompt';
import {
  type ListQueryState,
  ListQueryView,
  QueryBoundary,
  teamMatchesQuery,
  teamsQuery,
} from '../../../src/query';
import { useTheme } from '../../../src/theme';
import { Badge, type BadgeTone, Button, Numeral, Screen, Text } from '../../../src/ui';

/** RSVP tag of the viewer: the state fill of the brand (maybe = warning; waitlist neutral). */
const RSVP_TONE: Readonly<Record<NonNullable<MatchSummary['myRsvp']>, BadgeTone>> = {
  in: 'positive',
  maybe: 'warning',
  out: 'negative',
  waitlist: 'neutral',
};

/** Day of month, short weekday and month, and the kick-off time, in the reader's language. */
function kickoff(iso: string, language: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return { day: '', weekday: '', time: '' };
  }
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(language, options).format(date);
  return {
    day: part({ day: 'numeric' }),
    weekday: `${part({ weekday: 'short' })} ${part({ month: 'short' })}`,
    time: part({ hour: '2-digit', minute: '2-digit' }),
  };
}

/**
 * A match as a scoreboard row: a date column (day in kit-number figures, weekday and month
 * under it), the team, format and venue with the kick-off time, and the squad count with the
 * viewer's RSVP on the right. One button that speaks the same facts.
 */
function MatchRow({
  match,
  teamName,
  onPress,
}: {
  readonly match: MatchSummary;
  readonly teamName: string;
  readonly onPress: () => void;
}) {
  const { t, i18n } = useTranslation('common');
  const { t: tm } = useTranslation('matches');
  const theme = useTheme();
  const when = kickoff(match.startsAt, i18n.language);
  const subtitle = [
    t('matches.itemSubtitle', { team: teamName, format: match.format }),
    match.venue?.name ?? match.venueText,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
  const voting = match.status === 'played';
  const count = voting
    ? tm('tab.voting')
    : t('matches.slots', { confirmed: match.counts.in, slots: match.slots });
  const rsvp =
    match.myRsvp === null
      ? null
      : { label: tm(`rsvp.state.${match.myRsvp}`), tone: RSVP_TONE[match.myRsvp] };
  const spoken = [formatDateTime(match.startsAt, i18n.language), subtitle, count, rsvp?.label]
    .filter((part): part is string => part !== undefined && part !== null && part !== '')
    .join(', ');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={spoken}
      accessibilityHint={tm('tab.openHint')}
      onPress={onPress}
      testID={`match-${match.id}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing['3'],
        minHeight: theme.layout.rowMinHeight,
        paddingHorizontal: theme.spacing['4'],
        paddingVertical: theme.spacing['3'],
        backgroundColor: pressed ? theme.colors.pressed : theme.colors.surface,
      })}
    >
      <View style={{ width: theme.spacing['12'], alignItems: 'center' }}>
        <Numeral value={when.day} />
        <Text variant="caption" tone="muted" align="center">
          {when.weekday}
        </Text>
      </View>
      <View style={{ flex: 1, gap: theme.spacing['1'] }}>
        <Numeral value={when.time} />
        <Text variant="footnote" tone="muted" numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: theme.spacing['1'] }}>
        {voting ? (
          <Text variant="label" tone="primary">
            {count}
          </Text>
        ) : (
          <Numeral value={count} variant="score" />
        )}
        {rsvp === null ? null : <Badge label={rsvp.label} tone={rsvp.tone} />}
      </View>
    </Pressable>
  );
}

/**
 * Upcoming matches of every team the user belongs to, plus played matches whose MVP vote is
 * open. The API lists matches per team (`GET /api/v1/teams/:id/matches`), so the first page of
 * each team is read and merged by start time. Each team's full list (and, for its staff, creating
 * a match) is one tap away.
 */
export default function MatchesTab() {
  const { t } = useTranslation('common');
  const { t: tm } = useTranslation('matches');
  const theme = useTheme();
  const router = useRouter();
  const teamsResult = useInfiniteQuery(teamsQuery(api));
  const teams = teamsResult.data?.pages.flatMap((page) => page.items) ?? [];
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));

  const matchResults = useQueries({
    queries: teams.map((team) => teamMatchesQuery(api, team.id)),
  });
  const matches = tabMatches(
    matchResults.flatMap((result) => result.data?.items ?? ([] as MatchSummary[])),
  );

  const firstMatchError = matchResults.find((result) => result.status === 'error')?.error;
  const query: ListQueryState = {
    status:
      teamsResult.status !== 'success'
        ? teamsResult.status
        : matchResults.some((result) => result.status === 'pending')
          ? 'pending'
          : firstMatchError === undefined
            ? 'success'
            : 'error',
    error: teamsResult.error ?? firstMatchError ?? null,
    isRefetching: teamsResult.isRefetching || matchResults.some((result) => result.isRefetching),
    refetch: () => {
      void teamsResult.refetch();
      for (const result of matchResults) {
        void result.refetch();
      }
    },
  };
  const hasNoTeam = teamsResult.status === 'success' && teams.length === 0;

  return (
    <Screen title={t('tabs.matches')}>
      <PushPrompt />
      {teams.length === 0 ? null : (
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing['2'],
            paddingHorizontal: theme.spacing['4'],
            paddingBottom: theme.spacing['3'],
          }}
        >
          {teams.map((team) => (
            <Button
              key={team.id}
              label={tm('tab.teamMatches', { team: team.name })}
              accessibilityHint={tm('tab.teamMatchesHint')}
              variant="secondary"
              onPress={() => router.push(teamMatchesHref(team.id))}
              testID={`team-matches-${team.id}`}
            />
          ))}
        </View>
      )}
      <QueryBoundary>
        <ListQueryView
          testID="matches-list"
          query={query}
          items={matches}
          keyExtractor={(match) => match.id}
          renderItem={(match) => (
            <MatchRow
              match={match}
              teamName={teamNames.get(match.teamId) ?? ''}
              onPress={() => router.push(matchHref(match.teamId, match.id))}
            />
          )}
          empty={
            hasNoTeam
              ? { title: t('matches.noTeamTitle'), message: t('matches.noTeamMessage') }
              : { title: t('matches.emptyTitle'), message: t('matches.emptyMessage') }
          }
        />
      </QueryBoundary>
    </Screen>
  );
}
