import { useInfiniteQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { api } from '../../../src/api/instance';
import { type VenueSummary } from '../../../src/api/contracts';
import { formatPriceRange } from '../../../src/i18n/format';
import { ListQueryView, QueryBoundary, venuesQuery } from '../../../src/query';
import { ListItem, Screen } from '../../../src/ui';

/** Pitch directory (`GET /api/v1/venues`); sample rows keep their `[ÖRNEK]` name prefix. */
export default function VenuesTab() {
  const { t, i18n } = useTranslation('common');
  const query = useInfiniteQuery(venuesQuery(api));
  const venues = query.data?.pages.flatMap((page) => page.items) ?? [];

  const subtitle = (venue: VenueSummary): string => {
    const parts = [
      t(venue.verified ? 'venues.verified' : 'venues.unverified'),
      t(venue.indoor ? 'venues.indoor' : 'venues.outdoor'),
      formatPriceRange(venue.priceMinMinor, venue.priceMaxMinor, i18n.language),
    ];
    return parts.filter((part): part is string => part !== null).join(' · ');
  };

  return (
    <Screen title={t('tabs.venues')}>
      <QueryBoundary>
        <ListQueryView
          testID="venues-list"
          query={query}
          items={venues}
          keyExtractor={(venue) => venue.id}
          renderItem={(venue) => (
            <ListItem
              title={venue.name}
              subtitle={subtitle(venue)}
              meta={
                venue.rating.average === null
                  ? t('venues.noRating')
                  : venue.rating.average.toLocaleString(i18n.language, {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })
              }
            />
          )}
          empty={{ title: t('venues.emptyTitle'), message: t('venues.emptyMessage') }}
        />
      </QueryBoundary>
    </Screen>
  );
}
