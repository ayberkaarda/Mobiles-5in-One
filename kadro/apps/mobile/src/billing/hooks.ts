import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect } from 'react';

import { type ApiClient } from '../api/client';
import { type AuthStatus } from '../auth-store/store';
import { type MeResponse } from '../profile/contracts';
import { profileKeys } from '../profile/queries';
import { QUERY_ROOTS } from '../query/keys';
import { meQuery } from '../query/resources';
import { type BillingPort } from './port';

/** Pro as the server reports it; a profile that is not loaded yet means no Pro. */
export function isPro(me: Pick<MeResponse, 'entitlements'> | undefined): boolean {
  return me?.entitlements.pro === true;
}

/**
 * Keeps the store customer equal to the signed-in user (`app_user_id` = `users.id`, ADR-0063).
 * Sign-out is handled where the port is created (`session.onSignOut`). A failure is not shown:
 * the paywall reports an unavailable store when it needs one.
 */
export function useBillingIdentity(
  port: BillingPort,
  status: AuthStatus,
  userId: string | undefined,
): void {
  useEffect(() => {
    if (!port.available || status !== 'signedIn' || userId === undefined) {
      return;
    }
    void port.logIn(userId).catch(() => undefined);
  }, [port, status, userId]);
}

/**
 * Re-reads the profile from the server and reports whether it says Pro. The statistics and the
 * team list depend on the entitlement too, so they are marked stale.
 */
export function useRefreshPro(api: ApiClient): () => Promise<boolean> {
  const queryClient = useQueryClient();
  return useCallback(async () => {
    const me = await queryClient.fetchQuery({ ...meQuery(api), staleTime: 0 });
    void queryClient.invalidateQueries({ queryKey: profileKeys.stats() });
    void queryClient.invalidateQueries({ queryKey: [QUERY_ROOTS.teams] });
    return isPro(me);
  }, [api, queryClient]);
}
