import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { formatDateTime } from '../../../../src/i18n/format';
import { MatchScreen, matchHref } from '../../../../src/matches/components';
import { matchesApi } from '../../../../src/matches/instance';
import { canCreateMatch } from '../../../../src/matches/permissions';
import { teamAllMatchesQuery } from '../../../../src/matches/queries';
import { ListQueryView, QueryBoundary } from '../../../../src/query';
import { Notice } from '../../../../src/teams/components';
import { teamsApi } from '../../../../src/teams/instance';
import { teamDetailQuery } from '../../../../src/teams/queries';
import { useTheme } from '../../../../src/theme';
import { Button, ListItem } from '../../../../src/ui';

/**
 * Every match of one team, newest start first (`GET /api/v1/teams/:id/matches`, paginated), with
 * "create a match" for the team's staff (authorization matrix §3.4, footnote 10).
 */
export default function TeamMatchesScreen() {
  const { t, i18n } = useTranslation('matches');
  const theme = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const teamId = typeof params.id === 'string' ? params.id : '';
  const team = useQuery({ ...teamDetailQuery(teamsApi, teamId), enabled: teamId !== '' });
  const query = useInfiniteQuery({
    ...teamAllMatchesQuery(matchesApi, teamId),
    enabled: teamId !== '',
  });
  const matches = query.data?.pages.flatMap((page) => page.items) ?? [];
  const staffCanCreate = team.data !== undefined && canCreateMatch(team.data);

  return (
    <MatchScreen
      title={t('team.title')}
      subtitle={team.data?.name}
      scroll={false}
      testID="team-matches-screen"
    >
      {team.data === undefined ? null : (
        <View style={{ paddingHorizontal: theme.spacing['4'], marginBottom: theme.spacing['3'] }}>
          {staffCanCreate ? (
            <Button
              label={t('team.create')}
              onPress={() => router.push(`/takim/${encodeURIComponent(teamId)}/mac/yeni`)}
              testID="match-create"
            />
          ) : team.data.isProLocked && team.data.myRole !== 'player' ? (
            <Notice testID="match-create-locked">{t('team.locked')}</Notice>
          ) : null}
        </View>
      )}
      <QueryBoundary>
        <ListQueryView
          testID="team-matches"
          query={query}
          items={matches}
          keyExtractor={(match) => match.id}
          renderItem={(match) => (
            <ListItem
              chevron
              title={formatDateTime(match.startsAt, i18n.language)}
              subtitle={[
                t(`status.${match.status}`),
                match.format,
                match.venue?.name ?? match.venueText,
              ]
                .filter((part): part is string => part !== null && part !== '')
                .join(' · ')}
              meta={t('team.slots', { confirmed: match.counts.in, slots: match.slots })}
              accessibilityHint={t('tab.openHint')}
              onPress={() => router.push(matchHref(teamId, match.id))}
              testID={`match-${match.id}`}
            />
          )}
          empty={{
            title: t('team.emptyTitle'),
            message: staffCanCreate ? t('team.emptyStaff') : t('team.emptyMessage'),
          }}
        />
      </QueryBoundary>
    </MatchScreen>
  );
}
