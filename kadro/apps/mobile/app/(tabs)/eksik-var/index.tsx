import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { type CallFilters, NO_FILTERS } from '../../../src/calls/calls-api';
import { DistrictPicker, levelLabel, positionLabel } from '../../../src/calls/components';
import { type Level, type OpenCallPublic, type Position } from '../../../src/calls/contracts';
import { districtLabel, LEVEL_OPTIONS, POSITION_OPTIONS } from '../../../src/calls/form';
import { callsApi } from '../../../src/calls/instance';
import { callHref } from '../../../src/calls/links';
import { callKeys, districtsQuery, openCallListQuery } from '../../../src/calls/queries';
import { formatDateTime } from '../../../src/i18n/format';
import { ChoiceGroup } from '../../../src/matches/components';
import { ListQueryView, QueryBoundary } from '../../../src/query';
import { useTheme } from '../../../src/theme';
import { Button, ListItem, Screen } from '../../../src/ui';

const ANY = 'any';

function activeFilterCount(filters: CallFilters): number {
  return [filters.district, filters.level, filters.position].filter((value) => value !== null)
    .length;
}

/**
 * Open calls for missing players (`GET /api/v1/open-calls`, public projection, footnote 18),
 * filtered by district, level and position. Only a district id is sent, never the device
 * location. A row opens the call, where the viewer can apply.
 */
export default function OpenCallsTab() {
  const { t: tc } = useTranslation('common');
  const { t, i18n } = useTranslation('opencalls');
  const theme = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const [filters, setFilters] = useState<CallFilters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const query = useInfiniteQuery(openCallListQuery(callsApi, filters));
  const districts = useQuery(districtsQuery(callsApi));
  const calls = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = activeFilterCount(filters);

  const place = (call: OpenCallPublic): string | null =>
    call.venue?.name ?? districtLabel(districts.data?.items, call.districtId);

  const open = (call: OpenCallPublic): void => {
    // The detail reads the call from the cache: there is no single-call endpoint.
    client.setQueryData(callKeys.call(call.id), call);
    router.push(callHref(call.id));
  };

  return (
    <Screen title={tc('tabs.openCalls')}>
      <View style={{ paddingHorizontal: theme.spacing['4'], paddingBottom: theme.spacing['3'] }}>
        <Button
          label={filtered === 0 ? t('filters.show') : t('filters.showCount', { number: filtered })}
          variant="secondary"
          accessibilityHint={t('filters.hint')}
          onPress={() => setShowFilters((value) => !value)}
          testID="filters-toggle"
        />
        {showFilters ? (
          <View style={{ marginTop: theme.spacing['3'], gap: theme.spacing['3'] }} testID="filters">
            <DistrictPicker
              districts={districts}
              selected={filters.district}
              onSelect={(district) => setFilters((current) => ({ ...current, district }))}
              noneLabel={t('district.all')}
              testID="filter-district"
            />
            <ChoiceGroup
              label={t('facts.level')}
              options={[ANY, ...LEVEL_OPTIONS].map((value) => ({
                value,
                label: levelLabel(t, value === ANY ? null : (value as Level)),
              }))}
              selected={filters.level ?? ANY}
              onSelect={(value) =>
                setFilters((current) => ({
                  ...current,
                  level: value === ANY ? null : (value as Level),
                }))
              }
              testID="filter-level"
            />
            <ChoiceGroup
              label={t('facts.position')}
              options={[ANY, ...POSITION_OPTIONS].map((value) => ({
                value,
                label:
                  value === ANY ? t('filters.anyPosition') : positionLabel(t, value as Position),
              }))}
              selected={filters.position ?? ANY}
              onSelect={(value) =>
                setFilters((current) => ({
                  ...current,
                  position: value === ANY ? null : (value as Position),
                }))
              }
              testID="filter-position"
            />
            {filtered === 0 ? null : (
              <Button
                label={t('filters.reset')}
                variant="secondary"
                onPress={() => setFilters(NO_FILTERS)}
                testID="filters-reset"
              />
            )}
          </View>
        ) : null}
      </View>
      <QueryBoundary>
        <ListQueryView
          testID="open-calls-list"
          query={query}
          items={calls}
          keyExtractor={(call) => call.id}
          renderItem={(call) => (
            <ListItem
              title={call.teamName}
              subtitle={[
                formatDateTime(call.startsAt, i18n.language),
                call.format,
                place(call),
                positionLabel(t, call.position),
              ]
                .filter((part): part is string => part !== null && part !== '')
                .join(' · ')}
              meta={t('list.missing', { number: call.missingCount })}
              accessibilityHint={t('list.openHint')}
              onPress={() => open(call)}
              testID={`open-call-${call.id}`}
            />
          )}
          empty={
            filtered === 0
              ? { title: t('list.emptyTitle'), message: t('list.emptyMessage') }
              : {
                  title: t('list.emptyFilteredTitle'),
                  message: t('list.emptyFilteredMessage'),
                  action: { label: t('filters.reset'), onPress: () => setFilters(NO_FILTERS) },
                }
          }
        />
      </QueryBoundary>
    </Screen>
  );
}
