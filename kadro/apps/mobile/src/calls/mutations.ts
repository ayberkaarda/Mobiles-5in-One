import {
  type InfiniteData,
  type QueryClient,
  useIsMutating,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';

import { ApiError } from '../api/errors';
import { matchKeys } from '../matches/queries';
import { queryKeys } from '../query/keys';
import { type CallsApi } from './calls-api';
import {
  type Application,
  type ApplicationStatusTarget,
  type OpenCall,
  type PublishOpenCallRequest,
} from './contracts';
import { type ApplicationsPage, callKeys } from './queries';

/**
 * Writes of the open-call area. None is optimistic: applying, publishing, closing and deciding
 * are checked by the server against state the app cannot see (other applicants, free places,
 * expiry, ADR-0003), so each waits for the answer. The answer is written into the cache, related
 * lists refetch in the background (never awaited).
 *
 * Writes on one call share a mutation key, and so do writes on one match's call; screens disable
 * the controls while one runs.
 */
export const callWriteKey = (callId: string) => ['call-write', callId] as const;
export const matchCallWriteKey = (matchId: string) => ['match-call-write', matchId] as const;

export function useCallBusy(callId: string): boolean {
  return useIsMutating({ mutationKey: callWriteKey(callId) }) > 0;
}

export function useMatchCallBusy(matchId: string): boolean {
  return useIsMutating({ mutationKey: matchCallWriteKey(matchId) }) > 0;
}

function refreshLists(client: QueryClient): void {
  void client.invalidateQueries({ queryKey: callKeys.lists() });
}

/** The cached applications with `updated` in place of its earlier copy. */
function replaceApplication(client: QueryClient, callId: string, updated: Application): void {
  client.setQueryData<InfiniteData<ApplicationsPage>>(callKeys.applications(callId), (data) =>
    data === undefined
      ? data
      : {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            items: page.items.map((row) => (row.id === updated.id ? updated : row)),
          })),
        },
  );
}

/** A 409 means the server saw a newer state than the screen: read the applications again. */
function refreshAfterConflict(client: QueryClient, callId: string, error: unknown): void {
  if (error instanceof ApiError && error.status === 409) {
    void client.invalidateQueries({ queryKey: callKeys.applications(callId) });
  }
}

/**
 * `POST open-calls/:id/applications`. Pessimistic: "applied" shows only after the server stored
 * the application; the answer becomes the viewer's own row. `already_applied` re-reads the row.
 */
export function useApply(calls: CallsApi, callId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: callWriteKey(callId),
    mutationFn: (message: string | undefined) => calls.apply(callId, message),
    onSuccess: (application) => {
      const page: ApplicationsPage = { items: [application], nextCursor: null, related: true };
      client.setQueryData<InfiniteData<ApplicationsPage>>(callKeys.applications(callId), {
        pages: [page],
        pageParams: [undefined],
      });
    },
    onError: (error) => refreshAfterConflict(client, callId, error),
  });
}

interface StatusChange {
  readonly applicationId: string;
  readonly status: ApplicationStatusTarget;
}

/**
 * Accept / reject (staff) or withdraw (applicant). After an acceptance the match gains a
 * participant and the call one place fewer; at zero the server closes the call and rejects the
 * remaining pending applications (footnote 21), so the applications and the match refetch.
 */
export function useSetApplicationStatus(
  calls: CallsApi,
  callId: string,
  matchId: string | null = null,
) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: callWriteKey(callId),
    mutationFn: ({ applicationId, status }: StatusChange) =>
      calls.setApplicationStatus(callId, applicationId, status),
    onSuccess: (application) => {
      replaceApplication(client, callId, application);
      if (application.status !== 'accepted') {
        return;
      }
      if (matchId !== null) {
        const stored = client.getQueryData<OpenCall | null>(callKeys.matchCall(matchId));
        if (stored !== undefined && stored !== null && stored.id === callId) {
          // Footnote 21: one place fewer; at zero the call is closed.
          const missingCount = Math.max(0, stored.missingCount - 1);
          client.setQueryData<OpenCall>(callKeys.matchCall(matchId), {
            ...stored,
            missingCount,
            status: missingCount === 0 ? 'closed' : stored.status,
          });
        }
        void client.invalidateQueries({ queryKey: matchKeys.detail(matchId) });
      }
      void client.invalidateQueries({ queryKey: callKeys.applications(callId) });
      refreshLists(client);
    },
    onError: (error) => refreshAfterConflict(client, callId, error),
  });
}

/** `POST matches/:id/open-call` (staff); the answer is kept as the match's call. */
export function usePublishCall(calls: CallsApi, matchId: string, teamId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: matchCallWriteKey(matchId),
    mutationFn: (body: PublishOpenCallRequest) => calls.publishOpenCall(matchId, body),
    onSuccess: (call) => {
      client.setQueryData<OpenCall | null>(callKeys.matchCall(matchId), call);
      refreshLists(client);
      void client.invalidateQueries({ queryKey: queryKeys.teamMatches(teamId) });
    },
  });
}

/**
 * `PATCH matches/:id/open-call` (staff). Needs only the match, so it also ends a call this device
 * never published (`open_call_exists`). The server rejects the remaining pending applications.
 */
export function useCloseCall(calls: CallsApi, matchId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: matchCallWriteKey(matchId),
    mutationFn: () => calls.closeOpenCall(matchId),
    onSuccess: (call) => {
      client.setQueryData<OpenCall | null>(callKeys.matchCall(matchId), call);
      void client.invalidateQueries({ queryKey: callKeys.applications(call.id) });
      refreshLists(client);
    },
  });
}
