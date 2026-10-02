import { fireEvent, screen, waitFor } from '@testing-library/react-native/pure';
import { type QueryClient } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { type MatchSummary } from '../src/api/contracts';
import { ApiError } from '../src/api/errors';
import {
  containsSensitiveField,
  createQueryClient,
  type ListQueryState,
  ListQueryView,
  PERSISTED_QUERY_ROOTS,
  queryKeys,
  shouldPersistQuery,
  upcomingMatches,
} from '../src/query';
import { ListItem } from '../src/ui';
import { renderWithProviders } from './support/render';

function cachedQuery(
  queryKey: readonly unknown[],
  data: unknown,
  status: 'success' | 'error' = 'success',
) {
  return { queryKey, state: { status, data } } as unknown as Parameters<
    typeof shouldPersistQuery
  >[0];
}

describe('persisted query allow-list (threat model T-MOB-04)', () => {
  it('persists the offline lists and never the own profile', () => {
    expect([...PERSISTED_QUERY_ROOTS].sort()).toEqual([
      'districts',
      'matches',
      'open-calls',
      'teams',
      'venues',
    ]);
    expect(shouldPersistQuery(cachedQuery(queryKeys.teams(), { pages: [] }))).toBe(true);
    expect(shouldPersistQuery(cachedQuery(queryKeys.me(), { displayName: 'Ali' }))).toBe(false);
    expect(shouldPersistQuery(cachedQuery(['auth', 'session'], {}))).toBe(false);
  });

  it('persists successful results only', () => {
    expect(shouldPersistQuery(cachedQuery(queryKeys.venues(), undefined, 'error'))).toBe(false);
  });

  it('keeps an allowed query in memory when its data carries a credential-like field', () => {
    const leaked = { pages: [{ items: [{ id: '1', owner: { email: 'a@b.c' } }] }] };
    expect(containsSensitiveField(leaked)).toBe(true);
    expect(shouldPersistQuery(cachedQuery(queryKeys.teams(), leaked))).toBe(false);
    expect(containsSensitiveField({ items: [{ refreshToken: 'x' }] })).toBe(true);
    expect(containsSensitiveField({ items: [{ name: 'Moda', priceMinMinor: 1 }] })).toBe(false);
  });
});

describe('query client defaults', () => {
  it('works offline-first, leaves retries to the API client and never retries mutations', () => {
    const client: QueryClient = createQueryClient();
    const { queries, mutations } = client.getDefaultOptions();
    expect(queries).toMatchObject({
      networkMode: 'offlineFirst',
      retry: false,
      refetchOnReconnect: true,
    });
    expect(queries?.gcTime).toBe(24 * 60 * 60 * 1000);
    expect(mutations).toMatchObject({ retry: false });
  });
});

describe('upcomingMatches', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const match = (id: string, startsAt: string, status: MatchSummary['status']) =>
    ({ id, startsAt, status }) as MatchSummary;

  it('keeps matches ahead (or started within 3 h) in start order and drops played and cancelled', () => {
    const result = upcomingMatches(
      [
        match('later', '2026-10-05T18:00:00Z', 'open'),
        match('played', '2026-10-03T18:00:00Z', 'played'),
        match('soon', '2026-10-02T18:00:00Z', 'locked'),
        match('cancelled', '2026-10-04T18:00:00Z', 'cancelled'),
        match('old', '2026-10-01T18:00:00Z', 'open'),
        match('running', '2026-10-02T10:30:00Z', 'locked'),
      ],
      now,
    );
    expect(result.map((entry) => entry.id)).toEqual(['running', 'soon', 'later']);
  });
});

describe('ListQueryView', () => {
  const baseState: ListQueryState = {
    status: 'success',
    error: null,
    isRefetching: false,
    refetch: () => undefined,
  };
  const empty = { title: 'Henüz bir takımın yok', message: 'Kadroyu kur.' };
  const render = (state: ListQueryState, items: readonly string[]) =>
    renderWithProviders(
      <ListQueryView
        testID="list"
        query={state}
        items={items}
        keyExtractor={(item) => item}
        renderItem={(item) => <ListItem title={item} />}
        empty={empty}
      />,
    );

  it('shows skeleton rows on the first load', async () => {
    await render({ ...baseState, status: 'pending' }, []);
    expect(screen.getByRole('progressbar', { name: 'Yükleniyor' })).toBeTruthy();
  });

  it('shows the localized error with its reference and retries', async () => {
    const refetch = vi.fn();
    await render(
      {
        ...baseState,
        status: 'error',
        error: new ApiError({ kind: 'network' }),
        refetch,
      },
      [],
    );
    expect(
      screen.getByRole('alert', {
        name: 'Bağlantı kurulamadı. İnternetini kontrol edip tekrar dene.',
      }),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Tekrar dene' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('shows the empty state after a successful empty load', async () => {
    await render(baseState, []);
    expect(screen.getByRole('header', { name: 'Henüz bir takımın yok' })).toBeTruthy();
  });

  it('shows the rows, and a notice when they are cached rows after a failure', async () => {
    await render({ ...baseState, status: 'error', error: new ApiError({ kind: 'network' }) }, [
      'Yıldızlar FK',
      'Moda Gençlik',
    ]);
    expect(screen.getByLabelText('Yıldızlar FK')).toBeTruthy();
    expect(screen.getByLabelText('Moda Gençlik')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByText('Bağlantı yok. Son kaydedilen bilgileri görüyorsun.')).toBeTruthy(),
    );
  });
});
