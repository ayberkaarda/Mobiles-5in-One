import Svg, { Circle, Path } from 'react-native-svg';

import { pitchDiagram, useTheme } from '../theme';

export interface EksikSlotProps {
  /** Diameter in points; 64 for empty states, 36 for a lineup slot. */
  readonly size?: number;
  /**
   * `screen`: on a screen surface (`borderStrong` outline, `textMuted` plus).
   * `pitch`: on the pitch diagram (`pitchLine` in both schemes).
   */
  readonly surface?: 'screen' | 'pitch';
  /** Spoken name; without it the glyph is decorative and hidden from screen readers. */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
}

/**
 * The "eksik" glyph: an outlined player marker with a dashed edge and a plus, the brand's mark for
 * a missing player (empty lineup slot, empty states).
 */
export function EksikSlot({
  size = 64,
  surface = 'screen',
  accessibilityLabel,
  testID,
}: EksikSlotProps) {
  const theme = useTheme();
  const outline = surface === 'pitch' ? theme.colors.pitchLine : theme.colors.borderStrong;
  const plus = surface === 'pitch' ? theme.colors.pitchLine : theme.colors.textMuted;
  const decorative = accessibilityLabel === undefined;
  // Drawn on a 36-unit grid (the lineup marker) and scaled to `size`.
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 36 36"
      testID={testID}
      accessible={!decorative}
      accessibilityRole={decorative ? undefined : 'image'}
      accessibilityLabel={accessibilityLabel}
      accessibilityElementsHidden={decorative}
      importantForAccessibility={decorative ? 'no-hide-descendants' : 'yes'}
    >
      <Circle
        cx={18}
        cy={18}
        r={17}
        fill="none"
        stroke={outline}
        strokeWidth={pitchDiagram.markerStroke}
        strokeDasharray={pitchDiagram.emptyMarkerDash}
      />
      <Path
        d="M18 12v12M12 18h12"
        stroke={plus}
        strokeWidth={pitchDiagram.markerStroke}
        strokeLinecap="round"
      />
    </Svg>
  );
}
