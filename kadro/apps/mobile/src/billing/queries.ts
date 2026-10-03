import { queryOptions } from '@tanstack/react-query';

import { QUERY_ROOTS } from '../query/keys';
import { type BillingPort } from './port';

/**
 * The store's price list lives under the `me` root: it is tied to the signed-in store customer,
 * so it is never written to the device and is dropped at sign-out like the profile.
 */
export const billingKeys = {
  offers: () => [QUERY_ROOTS.me, 'billing-offers'] as const,
};

export function offersQuery(port: BillingPort) {
  return queryOptions({
    queryKey: billingKeys.offers(),
    queryFn: () => port.loadOffers(),
    enabled: port.available,
    retry: false,
  });
}
