import { fireEvent, screen } from '@testing-library/react-native/pure';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import MatchesTab from '../app/(tabs)/maclar/index';
import OpenCallsTab from '../app/(tabs)/eksik-var/index';
import ProfileTab from '../app/(tabs)/profil/index';
import TeamsTab from '../app/(tabs)/takimlar/index';
import { session } from '../src/api/instance';
import { issueTokens, problem } from './support/api';
import { routerCalls } from './support/expo-router';
import { apiUrl, mswServer } from './support/msw';
import { renderWithProviders } from './support/render';

// The profile photo component loads `expo-image`, a native module.
vi.mock('expo-image', () => import('./support/expo-image'));

// The tab screens use the app's API client; here it is wired to the MSW base URL.
vi.mock('../src/api/instance', async () => {
  const { createTestApi } = await import('./support/api');
  const { api, session: testSession } = createTestApi();
  return { api, session: testSession };
});

const TEAM_ID = '0192a0b0-0000-7000-8000-000000000001';

const team = {
  id: TEAM_ID,
  name: 'Yıldızlar FK',
  slug: 'yildizlar-fk',
  badgeUrl: null,
  districtId: '0192a0b0-0000-7000-8000-0000000000d1',
  myRole: 'captain',
  memberCount: 9,
  isProLocked: false,
  createdAt: '2026-09-01T10:00:00.000Z',
};

function match(id: string, startsAt: string, status: string) {
  return {
    id,
    teamId: TEAM_ID,
    venue: { id: '0192a0b0-0000-7000-8000-0000000000e1', name: 'Moda Sahası', slug: 'moda-sahasi' },
    venueText: null,
    startsAt,
    format: '7v7',
    feeTotalMinor: 210_000,
    slots: 14,
    status,
    lockedAt: null,
    mvpVoteClosesAt: null,
    counts: { in: 9, maybe: 2, out: 1, waitlist: 0 },
    myRsvp: 'in',
    createdAt: '2026-09-20T10:00:00.000Z',
  };
}

beforeEach(async () => {
  await session.establish(issueTokens());
});

describe('Takımlar tab', () => {
  it('lists the teams from the API with role and squad size', async () => {
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () =>
        HttpResponse.json({ items: [team], nextCursor: null }),
      ),
    );
    await renderWithProviders(<TeamsTab />);
    expect(await screen.findByLabelText('Yıldızlar FK, Kaptan · 9 oyuncu')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Takımlar' })).toBeTruthy();
  });

  it('shows the empty state for a user without a team', async () => {
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    await renderWithProviders(<TeamsTab />);
    expect(await screen.findByRole('header', { name: 'Henüz bir takımın yok' })).toBeTruthy();
  });

  it('shows the error copy and request reference when the API fails', async () => {
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () => problem(404, 'not_found', 'req-teams-1')),
    );
    await renderWithProviders(<TeamsTab />);
    expect(await screen.findByText('Hata kodu: req-teams-1')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Tekrar dene' })).toBeTruthy();
  });
});

describe('Maçlar tab', () => {
  it('merges the upcoming matches of every team in start order', async () => {
    const inFuture = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () =>
        HttpResponse.json({ items: [team], nextCursor: null }),
      ),
      http.get(apiUrl(`/api/v1/teams/${TEAM_ID}/matches`), () =>
        HttpResponse.json({
          items: [
            match('0192a0b0-0000-7000-8000-0000000000a2', inFuture(3), 'open'),
            match('0192a0b0-0000-7000-8000-0000000000a1', inFuture(1), 'locked'),
            match('0192a0b0-0000-7000-8000-0000000000a3', inFuture(2), 'cancelled'),
          ],
          nextCursor: null,
        }),
      ),
    );
    await renderWithProviders(<MatchesTab />);
    const rows = await screen.findAllByText('Yıldızlar FK · 7v7 · Moda Sahası');
    expect(rows).toHaveLength(2);
    expect(screen.getAllByText('9/14')).toHaveLength(2);
  });

  it('explains that matches live in teams when the user has none', async () => {
    mswServer.use(
      http.get(apiUrl('/api/v1/teams'), () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    await renderWithProviders(<MatchesTab />);
    expect(await screen.findByRole('header', { name: 'Henüz bir takımın yok' })).toBeTruthy();
  });
});

describe('Eksik Var tab', () => {
  it('lists public open calls with the number of missing players', async () => {
    mswServer.use(
      http.get(apiUrl('/api/v1/districts'), () => HttpResponse.json({ items: [] })),
      http.get(apiUrl('/api/v1/open-calls'), () =>
        HttpResponse.json({
          items: [
            {
              id: '0192a0b0-0000-7000-8000-0000000000c1',
              districtId: '0192a0b0-0000-7000-8000-0000000000d1',
              startsAt: '2026-10-09T18:00:00.000Z',
              format: '6v6',
              missingCount: 2,
              position: null,
              level: 'regular',
              venue: null,
              teamName: 'Moda Gençlik',
              expiresAt: '2026-10-09T16:00:00.000Z',
            },
          ],
          nextCursor: null,
        }),
      ),
    );
    await renderWithProviders(<OpenCallsTab />);
    expect(await screen.findByText('Moda Gençlik')).toBeTruthy();
    expect(screen.getByText('2 eksik')).toBeTruthy();
  });
});

describe('Profil tab', () => {
  it('shows the own profile with its statistics and opens the editor and the settings', async () => {
    mswServer.use(
      http.get(apiUrl('/api/v1/me'), () =>
        HttpResponse.json({
          id: '0192a0b0-0000-7000-8000-0000000000f1',
          displayName: 'Ayşe Kaleci',
          avatarUrl: null,
          position: 'GK',
          level: 'regular',
          email: 'ayse@example.com',
          emailVerified: false,
          role: 'user',
          districtId: null,
          providers: { password: true, apple: false, google: false },
          createdAt: '2026-09-01T10:00:00.000Z',
        }),
      ),
      http.get(apiUrl('/api/v1/me/stats'), () =>
        HttpResponse.json({ tier: 'basic', matchesPlayed: 12, mvpCount: 3 }),
      ),
    );
    await renderWithProviders(<ProfileTab />);
    expect(await screen.findByText('Ayşe Kaleci')).toBeTruthy();
    expect(screen.getByText('E-posta adresin henüz doğrulanmadı.')).toBeTruthy();
    expect(screen.getByLabelText('Mevki: Kaleci')).toBeTruthy();
    expect(screen.getByLabelText('İlçe: Belirtilmedi')).toBeTruthy();
    expect(await screen.findByLabelText('Oynanan maç: 12')).toBeTruthy();
    expect(screen.getByLabelText('Maçın oyuncusu: 3')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Profili düzenle' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Ayarlar' }));
    expect(routerCalls()).toEqual([
      { method: 'push', href: '/profil/duzenle' },
      { method: 'push', href: '/ayarlar' },
    ]);
  });
});
