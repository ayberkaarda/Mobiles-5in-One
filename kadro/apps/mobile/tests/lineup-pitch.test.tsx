import { screen } from '@testing-library/react-native/pure';
import { describe, expect, it } from 'vitest';

import { type Position } from '../src/matches/contracts';
import { LineupPitch } from '../src/matches/LineupPitch';
import {
  missingCount,
  type PitchPlayer,
  shortName,
  sideMarkers,
} from '../src/matches/pitch-layout';
import { lightTheme } from '../src/theme';
import { renderWithProviders } from './support/render';

const KEEPER_MISSING = 'Kaleci eksik';

function player(number: number, name: string, position: Position | null): PitchPlayer {
  return { id: `p${number}`, number, name, position };
}

describe('pitch layout', () => {
  it('shortens names to an initial and the surname', () => {
    expect(shortName('Emre Kaya')).toBe('E. Kaya');
    expect(shortName('  Ali  Rıza Öztürk ')).toBe('A. Öztürk');
    expect(shortName('Zeynep')).toBe('Zeynep');
    expect(shortName('Abdurrahmanşah')).toBe('Abdurrahm.');
    expect(shortName('Can Karamustafaoğlu')).toBe('C. Karamusta.');
  });

  it('puts the goalkeeper in goal and draws the open places as eksik markers', () => {
    const markers = sideMarkers(
      'A',
      [player(2, 'Can Yıldız', 'DEF'), player(1, 'Emre Kaya', 'GK'), player(3, 'Mert Aydın', null)],
      7,
      KEEPER_MISSING,
    );
    expect(markers).toHaveLength(7);
    expect(markers[0]).toMatchObject({ id: 'p1', number: 1, name: 'E. Kaya', x: 150, y: 44 });
    expect(markers.slice(1, 3).map((marker) => marker.id)).toEqual(['p2', 'p3']);
    expect(markers.filter((marker) => marker.empty === true)).toHaveLength(4);
    // Every marker of side A stays in the top half.
    expect(markers.every((marker) => marker.y < 230)).toBe(true);
  });

  it('mirrors side B into the bottom half', () => {
    const top = sideMarkers('A', [player(1, 'Emre Kaya', 'GK')], 3, KEEPER_MISSING);
    const bottom = sideMarkers('B', [player(1, 'Emre Kaya', 'GK')], 3, KEEPER_MISSING);
    expect(bottom.map((marker) => marker.y)).toEqual(top.map((marker) => 460 - marker.y));
    expect(bottom.map((marker) => marker.id)).toEqual(['p1', 'B-empty-1', 'B-empty-2']);
  });

  it('leaves the keeper spot empty and labelled when the side has no goalkeeper and room left', () => {
    const markers = sideMarkers('A', [player(4, 'Burak Şahin', 'FWD')], 3, KEEPER_MISSING);
    expect(markers[0]).toEqual({
      id: 'A-empty-0',
      x: 150,
      y: 44,
      empty: true,
      emptyLabel: KEEPER_MISSING,
    });
    expect(markers[1]).toMatchObject({ id: 'p4', number: 4 });
  });

  it('fills the keeper spot with the first player when the side is full without a goalkeeper', () => {
    const markers = sideMarkers(
      'A',
      [player(1, 'Burak Şahin', 'FWD'), player(2, 'Can Yıldız', 'DEF')],
      2,
      KEEPER_MISSING,
    );
    expect(markers.map((marker) => marker.id)).toEqual(['p2', 'p1']);
    expect(markers.some((marker) => marker.empty === true)).toBe(false);
  });

  it('draws only the players without a capacity (guest view) and nothing for an empty side', () => {
    expect(sideMarkers('A', [player(1, 'Emre Kaya', 'GK')], null, KEEPER_MISSING)).toHaveLength(1);
    expect(sideMarkers('B', [], null, KEEPER_MISSING)).toEqual([]);
    expect(missingCount(3, null)).toBe(0);
    expect(missingCount(3, 7)).toBe(4);
    expect(missingCount(8, 7)).toBe(0);
  });

  it('drops the names once a half is crowded, keeping every marker inside the half', () => {
    const players = Array.from({ length: 15 }, (_, index) =>
      player(index + 1, `Oyuncu Numara${index + 1}`, null),
    );
    const markers = sideMarkers('A', players, 15, KEEPER_MISSING);
    expect(markers).toHaveLength(15);
    expect(markers.some((marker) => marker.name !== undefined)).toBe(false);
    expect(markers.every((marker) => marker.x > 10 && marker.x < 290 && marker.y < 230)).toBe(true);
    expect(new Set(markers.map((marker) => `${marker.x},${marker.y}`)).size).toBe(15);
  });
});

describe('LineupPitch', () => {
  const sideA = [player(1, 'Emre Kaya', 'GK'), player(2, 'Can Yıldız', 'DEF')];
  const sideB = [player(3, 'Mert Aydın', 'MID')];

  it.each(['light', 'dark'] as const)(
    'shows the counts, kit numbers and eksik places on the dark pitch (%s)',
    async (scheme) => {
      await renderWithProviders(
        <LineupPitch
          sideA={sideA}
          sideB={sideB}
          capacity={3}
          countsLabel="A takımı: 2/3 · B takımı: 1/3"
          testID="lineup"
        />,
        { scheme },
      );
      expect(screen.getByTestId('lineup-counts').props.accessibilityLabel).toBe(
        'A takımı: 2/3 · B takımı: 1/3',
      );
      expect(screen.getByText('2/3')).toBeTruthy();
      expect(screen.getByText('1/3')).toBeTruthy();
      expect(screen.getByText('eksik')).toBeTruthy();
      const pitch = screen.getByRole('image', {
        name: 'Diziliş: A takımı 2 oyuncu, B takımı 1 oyuncu, 3 eksik',
      });
      expect(pitch.props.testID).toBe('lineup-pitch');
      for (const id of ['p1', 'p2', 'p3', 'A-empty-2', 'B-empty-0', 'B-empty-2']) {
        expect(screen.getByTestId(`lineup-pitch-marker-${id}`)).toBeTruthy();
      }
      for (const label of ['E. Kaya', 'C. Yıldız', 'M. Aydın', KEEPER_MISSING]) {
        expect(screen.getByText(label)).toBeTruthy();
      }
      // The diagram keeps the fixed night turf in both schemes.
      const turf = screen.container.queryAll((instance) => instance.type === 'Rect')[0];
      expect(turf?.props.fill).toBe(lightTheme.colors.pitch);
    },
  );

  it('has no eksik count and a shorter summary in the guest view', async () => {
    await renderWithProviders(
      <LineupPitch
        sideA={sideA}
        sideB={sideB}
        capacity={null}
        countsLabel="A takımı · B takımı"
        testID="lineup"
      />,
    );
    expect(screen.queryByText('eksik')).toBeNull();
    expect(
      screen.getByRole('image', { name: 'Diziliş: A takımı 2 oyuncu, B takımı 1 oyuncu' }),
    ).toBeTruthy();
  });
});
