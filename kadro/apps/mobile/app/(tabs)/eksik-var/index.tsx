import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api } from '../../../src/api/instance';
import { formatDateTime } from '../../../src/i18n/format';
import { ListQueryView, openCallsQuery, QueryBoundary } from '../../../src/query';
import { ListItem, Screen } from '../../../src/ui';

/** Open calls for missing players (`GET /api/v1/open-calls`, public projection). */
export default function OpenCallsTab() {
  const { t, i18n } = useTranslation('common');
  const query = useInfiniteQuery(openCallsQuery(api));
  const calls = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Screen title={t('tabs.openCalls')}>
      <QueryBoundary>
        <ListQueryView
          testID="open-calls-list"
          query={query}
          items={calls}
          keyExtractor={(call) => call.id}
          renderItem={(call) => (
            <ListItem
              title={call.venue === null ? call.teamName : `${call.teamName} · ${call.venue.name}`}
              subtitle={t('openCalls.itemSubtitle', {
                date: formatDateTime(call.startsAt, i18n.language),
                format: call.format,
              })}
              meta={t('openCalls.missing', { number: call.missingCount })}
            />
          )}
          empty={{ title: t('openCalls.emptyTitle'), message: t('openCalls.emptyMessage') }}
        />
      </QueryBoundary>
    </Screen>
  );
}
