import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api } from '../../../src/api/instance';
import { ListQueryView, QueryBoundary, teamsQuery } from '../../../src/query';
import { ListItem, Screen } from '../../../src/ui';

/** Teams the user belongs to (`GET /api/v1/teams`). */
export default function TeamsTab() {
  const { t } = useTranslation('common');
  const query = useInfiniteQuery(teamsQuery(api));
  const teams = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Screen title={t('tabs.teams')}>
      <QueryBoundary>
        <ListQueryView
          testID="teams-list"
          query={query}
          items={teams}
          keyExtractor={(team) => team.id}
          renderItem={(team) => (
            <ListItem
              title={team.name}
              subtitle={t('teams.itemSubtitle', {
                role: t(`teams.role.${team.myRole}`),
                number: team.memberCount,
              })}
            />
          )}
          empty={{ title: t('teams.emptyTitle'), message: t('teams.emptyMessage') }}
        />
      </QueryBoundary>
    </Screen>
  );
}
