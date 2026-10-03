import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { type CallFilters, NO_FILTERS } from '../../../src/calls/calls-api';
import {
  DistrictPicker,
  levelLabel,
  OpenCallRow,
  positionLabel,
} from '../../../src/calls/components';
import { type Level, type OpenCallPublic, type Position } from '../../../src/calls/contracts';
import { districtLabel, LEVEL_OPTIONS, POSITION_OPTIONS } from '../../../src/calls/form';
import { callsApi } from '../../../src/calls/instance';
import { callHref } from '../../../src/calls/links';
import { callKeys, districtsQuery, openCallListQuery } from '../../../src/calls/queries';
import { districtFromLink } from '../../../src/links/district';
import { ChoiceGroup } from '../../../src/matches/components';
import { ListQueryView, QueryBoundary } from '../../../src/query';
import { useTheme } from '../../../src/theme';
import { Button, Chip, Screen, Text } from '../../../src/ui';

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
  const { t } = useTranslation('opencalls');
  const theme = useTheme();
  const router = useRouter();
  const client = useQueryClient();
  const [filters, setFilters] = useState<CallFilters>(NO_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const query = useInfiniteQuery(openCallListQuery(callsApi, filters));
  const districts = useQuery(districtsQuery(callsApi));
  const calls = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = activeFilterCount(filters);
  const params = useLocalSearchParams<{ il?: string | string[]; ilce?: string | string[] }>();
  const [linkedSlugs, setLinkedSlugs] = useState<string | null>(null);
  const [linkMissing, setLinkMissing] = useState(false);

  // District link `/eksik-var/<il>/<ilce>` (ADR-0045): once the district list is known, the
  // district filter is set from the slugs, once per link; an unknown district shows a notice.
  const link = districtFromLink(params.il, params.ilce, districts.data?.items);
  if (link !== null && link.slugs !== linkedSlugs) {
    const districtId = link.districtId;
    setLinkedSlugs(link.slugs);
    setLinkMissing(districtId === null);
    if (districtId !== null) {
      setFilters((current) => ({ ...current, district: districtId }));
    }
  }

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
        <Chip
          label={filtered === 0 ? t('filters.show') : t('filters.showCount', { number: filtered })}
          selected={showFilters || filtered > 0}
          accessibilityHint={t('filters.hint')}
          onPress={() => setShowFilters((value) => !value)}
          testID="filters-toggle"
        />
        {linkMissing ? (
          <Text
            tone="muted"
            accessibilityLiveRegion="polite"
            style={{ marginTop: theme.spacing['2'] }}
            testID="district-link-missing"
          >
            {t('district.linkNotFound')}
          </Text>
        ) : null}
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
              variant="filter"
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
              variant="filter"
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
            <OpenCallRow call={call} place={place(call)} onPress={() => open(call)} />
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
