import { useInfiniteQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { api } from '../../../src/api/instance';
import { ListQueryView, QueryBoundary, teamsQuery } from '../../../src/query';
import { useTheme } from '../../../src/theme';
import { TeamCrest } from '../../../src/teams/components';
import { Button, ListItem, Screen } from '../../../src/ui';

/** Teams the user belongs to (`GET /api/v1/teams`), with the ways to create or join one. */
export default function TeamsTab() {
  const { t } = useTranslation('common');
  const { t: tt } = useTranslation('teams');
  const theme = useTheme();
  const router = useRouter();
  const query = useInfiniteQuery(teamsQuery(api));
  const teams = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Screen title={t('tabs.teams')}>
      <View
        style={{
          flexDirection: 'row',
          gap: theme.spacing['3'],
          paddingHorizontal: theme.spacing['4'],
          paddingBottom: theme.spacing['3'],
        }}
      >
        <Button
          label={tt('list.create')}
          onPress={() => router.push('/takim/yeni')}
          testID="teams-create"
          style={{ flex: 1 }}
        />
        <Button
          label={tt('list.join')}
          variant="secondary"
          onPress={() => router.push('/takim/katil')}
          testID="teams-join"
          style={{ flex: 1 }}
        />
      </View>
      <QueryBoundary>
        <ListQueryView
          testID="teams-list"
          query={query}
          items={teams}
          keyExtractor={(team) => team.id}
          renderItem={(team) => (
            <ListItem
              leading={<TeamCrest name={team.name} />}
              chevron
              title={team.name}
              subtitle={t('teams.itemSubtitle', {
                role: t(`teams.role.${team.myRole}`),
                number: team.memberCount,
              })}
              meta={team.isProLocked ? tt('list.locked') : undefined}
              accessibilityHint={tt('list.openHint')}
              onPress={() => router.push(`/takim/${encodeURIComponent(team.id)}`)}
              testID={`team-${team.id}`}
            />
          )}
          empty={{ title: t('teams.emptyTitle'), message: t('teams.emptyMessage') }}
        />
      </QueryBoundary>
    </Screen>
  );
}
