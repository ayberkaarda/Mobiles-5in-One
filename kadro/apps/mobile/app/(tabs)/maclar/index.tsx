import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { type MatchSummary } from '../../../src/api/contracts';
import { api } from '../../../src/api/instance';
import { formatDateTime } from '../../../src/i18n/format';
import { matchHref, teamMatchesHref } from '../../../src/matches/components';
import { tabMatches } from '../../../src/matches/list';
import {
  type ListQueryState,
  ListQueryView,
  QueryBoundary,
  teamMatchesQuery,
  teamsQuery,
} from '../../../src/query';
import { useTheme } from '../../../src/theme';
import { Button, ListItem, Screen } from '../../../src/ui';

/**
 * Upcoming matches of every team the user belongs to, plus played matches whose MVP vote is
 * open. The API lists matches per team (`GET /api/v1/teams/:id/matches`), so the first page of
 * each team is read and merged by start time. Each team's full list (and, for its staff, creating
 * a match) is one tap away.
 */
export default function MatchesTab() {
  const { t, i18n } = useTranslation('common');
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
            <ListItem
              title={formatDateTime(match.startsAt, i18n.language)}
              subtitle={[
                t('matches.itemSubtitle', {
                  team: teamNames.get(match.teamId) ?? '',
                  format: match.format,
                }),
                match.venue?.name ?? match.venueText,
              ]
                .filter((part): part is string => part !== null && part !== '')
                .join(' · ')}
              meta={
                match.status === 'played'
                  ? tm('tab.voting')
                  : t('matches.slots', { confirmed: match.counts.in, slots: match.slots })
              }
              accessibilityHint={tm('tab.openHint')}
              onPress={() => router.push(matchHref(match.teamId, match.id))}
              testID={`match-${match.id}`}
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
