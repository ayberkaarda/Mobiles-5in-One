import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';

import { QUERY_ROOTS, queryKeys } from '../query/keys';
import { type MeResponse, type UpdateMeRequest } from './contracts';
import { type ProfileApi } from './profile-api';

/** Every write of the own profile shares this key; profile controls are disabled while one runs. */
export const PROFILE_WRITE_KEY = ['profile-write'] as const;

export function useProfileBusy(): boolean {
  return useIsMutating({ mutationKey: PROFILE_WRITE_KEY }) > 0;
}

/**
 * `PATCH me`, pessimistic: the answer is the new profile and replaces the cached one, so every
 * screen that reads `me` (the district a new team gets, ADR-0050) sees it at once. Rosters and
 * match lists show the name and avatar of members, so they are refetched in the background; the
 * write never waits for that.
 */
export function useUpdateProfile(profile: ProfileApi) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: PROFILE_WRITE_KEY,
    mutationFn: (body: UpdateMeRequest) => profile.updateMe(body),
    onSuccess: (me: MeResponse, body) => {
      client.setQueryData(queryKeys.me(), me);
      if (body.displayName !== undefined || body.avatar !== undefined) {
        void client.invalidateQueries({ queryKey: [QUERY_ROOTS.teams, 'detail'] });
        void client.invalidateQueries({ queryKey: [QUERY_ROOTS.matches, 'detail'] });
      }
    },
    gcTime: 0,
  });
}
