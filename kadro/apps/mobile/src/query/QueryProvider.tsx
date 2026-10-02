import { type QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { type ReactNode, useMemo } from 'react';

import { type QueryPersister, persistOptions } from './persistence';

export interface QueryProviderProps {
  readonly client: QueryClient;
  readonly persister: QueryPersister;
  /** App version: a new version starts with an empty device cache. */
  readonly cacheBuster: string;
  readonly children: ReactNode;
}

/** Query client restored from and saved to the allow-listed device cache. */
export function QueryProvider({ client, persister, cacheBuster, children }: QueryProviderProps) {
  const options = useMemo(() => persistOptions(persister, cacheBuster), [persister, cacheBuster]);
  return (
    <PersistQueryClientProvider client={client} persistOptions={options}>
      {children}
    </PersistQueryClientProvider>
  );
}

/**
 * Drops every cached query, in memory and on the device. Registered as a sign-out listener, so
 * signing out, a session ending on a refresh rejection, and a start without a session all leave
 * nothing of the previous user behind (threat model T-MOB-04).
 */
export async function clearQueryCaches(
  client: QueryClient,
  persister: QueryPersister,
): Promise<void> {
  await client.cancelQueries();
  client.clear();
  await persister.removeClient();
}
