import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { DistrictPicker } from '../../../src/calls/components';
import { districtLabel } from '../../../src/calls/form';
import { callsApi } from '../../../src/calls/instance';
import { districtsQuery } from '../../../src/calls/queries';
import { MATCH_LIMITS } from '../../../src/matches/form';
import { ListQueryView, QueryBoundary } from '../../../src/query';
import { useTheme } from '../../../src/theme';
import { Button, Chip, Screen, TextField } from '../../../src/ui';
import { VenueRow } from '../../../src/venues/components';
import { venueSearchIssue } from '../../../src/venues/form';
import { venuesApi } from '../../../src/venues/instance';
import { NEW_VENUE_HREF, venueHref } from '../../../src/venues/links';
import { venueListQuery } from '../../../src/venues/queries';
import { NO_VENUE_FILTERS, type VenueFilters } from '../../../src/venues/venues-api';

const SEARCH_PARAMS = { min: MATCH_LIMITS.searchMin, max: MATCH_LIMITS.searchMax } as const;

/**
 * Saha Rehberi: the venue directory (`GET /api/v1/venues`), searchable by name and filtered by
 * district. Verified and sample venues for everyone, plus the viewer's own unverified ones. Sample
 * rows keep their `[ÖRNEK]` name and carry a sample label. A row opens the venue. List only: no
 * map view (ADR-0053).
 */
export default function VenuesTab() {
  const { t: tc } = useTranslation('common');
  const { t } = useTranslation('venues');
  const theme = useTheme();
  const router = useRouter();
  const [filters, setFilters] = useState<VenueFilters>(NO_VENUE_FILTERS);
  const [search, setSearch] = useState('');
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showDistrict, setShowDistrict] = useState(false);
  const query = useInfiniteQuery(venueListQuery(venuesApi, filters));
  const districts = useQuery(districtsQuery(callsApi));
  const venues = query.data?.pages.flatMap((page) => page.items) ?? [];
  const filtered = filters.district !== null || filters.q !== null;

  const runSearch = (): void => {
    if (search.trim() === '') {
      setSearchError(null);
      setFilters((current) => ({ ...current, q: null }));
      return;
    }
    const issue = venueSearchIssue(search);
    setSearchError(issue === null ? null : t(issue, SEARCH_PARAMS));
    if (issue === null) {
      setFilters((current) => ({ ...current, q: search.trim() }));
    }
  };

  const reset = (): void => {
    setSearch('');
    setSearchError(null);
    setFilters(NO_VENUE_FILTERS);
  };

  return (
    <Screen title={tc('tabs.venues')}>
      <View style={{ paddingHorizontal: theme.spacing['4'], paddingBottom: theme.spacing['3'] }}>
        <TextField
          label={t('list.searchLabel')}
          helperText={t('list.searchHelp', SEARCH_PARAMS)}
          error={searchError}
          value={search}
          onChangeText={(value) => {
            setSearch(value);
            setSearchError(null);
          }}
          onSubmitEditing={runSearch}
          returnKeyType="search"
          autoCorrect={false}
          testID="venue-search"
        />
        <View style={{ flexDirection: 'row', gap: theme.spacing['2'] }}>
          <Button
            label={t('list.search')}
            onPress={runSearch}
            testID="venue-search-submit"
            style={{ flex: 1 }}
          />
          <Button
            label={t('list.add')}
            variant="secondary"
            onPress={() => router.push(NEW_VENUE_HREF)}
            testID="venue-add"
            style={{ flex: 1 }}
          />
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: theme.spacing['2'],
            marginTop: theme.spacing['3'],
          }}
        >
          <Chip
            label={
              filters.district === null
                ? t('list.districtShow')
                : (districtLabel(districts.data?.items, filters.district) ?? t('list.districtSet'))
            }
            selected={showDistrict || filters.district !== null}
            accessibilityHint={t('list.districtHint')}
            onPress={() => setShowDistrict((value) => !value)}
            testID="venue-district-toggle"
          />
          {filtered ? (
            <Chip label={t('list.reset')} onPress={reset} testID="venue-filters-reset" />
          ) : null}
        </View>
        {showDistrict ? (
          <View style={{ marginTop: theme.spacing['3'] }}>
            <DistrictPicker
              districts={districts}
              selected={filters.district}
              onSelect={(district) => setFilters((current) => ({ ...current, district }))}
              noneLabel={t('list.districtAll')}
              testID="venue-district"
            />
          </View>
        ) : null}
      </View>
      <QueryBoundary>
        <ListQueryView
          testID="venues-list"
          query={query}
          items={venues}
          keyExtractor={(venue) => venue.id}
          renderItem={(venue) => (
            <VenueRow
              venue={venue}
              district={districtLabel(districts.data?.items, venue.districtId)}
              onPress={() => router.push(venueHref(venue.slug))}
            />
          )}
          empty={
            filtered
              ? {
                  title: t('list.emptyFilteredTitle'),
                  message: t('list.emptyFilteredMessage'),
                  action: { label: t('list.reset'), onPress: reset },
                }
              : {
                  title: t('list.emptyTitle'),
                  message: t('list.emptyMessage'),
                  action: { label: t('list.add'), onPress: () => router.push(NEW_VENUE_HREF) },
                }
          }
        />
      </QueryBoundary>
    </Screen>
  );
}
