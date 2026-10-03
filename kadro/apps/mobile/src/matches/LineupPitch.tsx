import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useTheme } from '../theme';
import { Numeral, PitchView, Text } from '../ui';
import { type LineupSide } from './contracts';
import { missingCount, type PitchPlayer, sideMarkers } from './pitch-layout';

/** Widest the diagram grows on large phones and tablets, in points. */
const MAX_PITCH_WIDTH = 420;
/** Width before the first layout pass (the view box width). */
const INITIAL_PITCH_WIDTH = 300;

export interface LineupPitchProps {
  readonly sideA: readonly PitchPlayer[];
  readonly sideB: readonly PitchPlayer[];
  /** Players per side (`ceil(slots / 2)`); `null` in the guest view, which has no slot count. */
  readonly capacity: number | null;
  /** Spoken text of the count line ("A takımı: 7/7, B takımı: 6/7"). */
  readonly countsLabel: string;
  readonly testID?: string;
}

function SideCount({
  side,
  count,
  capacity,
}: {
  readonly side: LineupSide;
  readonly count: number;
  readonly capacity: number | null;
}) {
  const { t } = useTranslation('matches');
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing['2'] }}>
      <Text variant="label" tone="muted">
        {t('lineup.side', { side })}
      </Text>
      <Numeral value={capacity === null ? String(count) : `${count}/${capacity}`} />
    </View>
  );
}

/**
 * The lineup as a squad sheet: side counts over the pitch diagram (always dark), kit numbers on
 * the markers and outlined eksik markers for the open places of each side. The counts are read as
 * one line, the diagram as one image; the player rows below carry the details.
 */
export function LineupPitch({ sideA, sideB, capacity, countsLabel, testID }: LineupPitchProps) {
  const { t } = useTranslation('matches');
  const theme = useTheme();
  const gutter = theme.layout.gutter;
  // The diagram fills the content width (measured), up to MAX_PITCH_WIDTH.
  const [width, setWidth] = useState(INITIAL_PITCH_WIDTH);
  const keeperMissing = t('lineup.keeperMissing');
  const missing = missingCount(sideA.length, capacity) + missingCount(sideB.length, capacity);
  const markers = [
    ...sideMarkers('A', sideA, capacity, keeperMissing),
    ...sideMarkers('B', sideB, capacity, keeperMissing),
  ];
  const label =
    capacity === null
      ? t('lineup.pitchLabelOpen', { a: sideA.length, b: sideB.length })
      : t('lineup.pitchLabel', { a: sideA.length, b: sideB.length, missing });

  return (
    <View style={{ paddingHorizontal: gutter, marginBottom: theme.spacing['4'] }}>
      <View
        accessible
        accessibilityLabel={countsLabel}
        testID={testID && `${testID}-counts`}
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          marginBottom: theme.spacing['3'],
        }}
      >
        <SideCount side="A" count={sideA.length} capacity={capacity} />
        {missing > 0 ? (
          <View style={{ alignItems: 'center' }}>
            <Numeral value={missing} outlined tone="muted" />
            <Text variant="caption" tone="muted">
              {t('lineup.missing')}
            </Text>
          </View>
        ) : null}
        <SideCount side="B" count={sideB.length} capacity={capacity} />
      </View>
      <View
        onLayout={(event) => {
          const next = Math.min(Math.round(event.nativeEvent.layout.width), MAX_PITCH_WIDTH);
          if (next > 0 && next !== width) {
            setWidth(next);
          }
        }}
        style={{ alignItems: 'center' }}
      >
        <View
          style={{
            alignSelf: 'center',
            borderRadius: theme.radius.md,
            overflow: 'hidden',
          }}
        >
          <PitchView
            markers={markers}
            accessibilityLabel={label}
            width={width}
            testID={testID && `${testID}-pitch`}
          />
        </View>
      </View>
    </View>
  );
}
