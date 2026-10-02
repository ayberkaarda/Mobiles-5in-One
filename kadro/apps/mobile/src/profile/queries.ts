import { queryOptions } from '@tanstack/react-query';

import { QUERY_ROOTS } from '../query/keys';
import { type ProfileApi } from './profile-api';

/**
 * Query keys of the profile area. Both live under the `me` root, which is not in
 * `PERSISTED_QUERY_ROOTS`: the own profile carries the email address and linked providers, and
 * the statistics are personal too, so neither is ever written to the device. Like every query
 * they are dropped at sign-out.
 */
export const profileKeys = {
  stats: () => [QUERY_ROOTS.me, 'stats'] as const,
};

export function statsQuery(profile: ProfileApi) {
  return queryOptions({
    queryKey: profileKeys.stats(),
    queryFn: ({ signal }) => profile.getStats(signal),
  });
}
