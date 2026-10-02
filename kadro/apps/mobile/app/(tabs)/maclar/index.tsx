import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { type MatchSummary } from '../../../src/api/contracts';
import { api } from '../../../src/api/instance';
import { formatDateTime } from '../../../src/i18n/format';
import {
  type ListQueryState,
  ListQueryView,
  QueryBoundary,
  teamMatchesQuery,
  teamsQuery,
  upcomingMatches,
} from '../../../src/query';
import { ListItem, Screen } from '../../../src/ui';

/**
 * Upcoming matches of every team the user belongs to. The API lists matches per team
 * (`GET /api/v1/teams/:id/matches`), so the first page of each team is read and merged by start time.
 */
export default function MatchesTab() {
  const { t, i18n } = useTranslation('common');
  const teamsResult = useInfiniteQuery(teamsQuery(api));
  const teams = teamsResult.data?.pages.flatMap((page) => page.items) ?? [];
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));

  const matchResults = useQueries({
    queries: teams.map((team) => teamMatchesQuery(api, team.id)),
  });
  const matches = upcomingMatches(
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
              meta={t('matches.slots', { confirmed: match.counts.in, slots: match.slots })}
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
