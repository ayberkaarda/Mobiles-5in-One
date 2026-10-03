import { View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { pitchDiagram, useTheme } from '../theme';

/** One position on the pitch, in view box units (300 wide, 460 tall; side A at the top). */
export interface PitchMarker {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** Kit number shown on the marker; omit for an empty slot. */
  readonly number?: number | string;
  /** Short name under the marker ("E. Kaya"). */
  readonly name?: string;
  /** An unfilled slot: dashed chalk outline with a plus (the eksik glyph). */
  readonly empty?: boolean;
  /** Caption next to an empty slot, e.g. "Kaleci eksik". */
  readonly emptyLabel?: string;
}

export interface PitchViewProps {
  readonly markers?: readonly PitchMarker[];
  /** Spoken summary of the diagram, e.g. "A takımı 7 oyuncu, B takımı 6 oyuncu, 1 eksik". */
  readonly accessibilityLabel: string;
  /** Called with the marker id when a marker is tapped (assigning a bench player). */
  readonly onMarkerPress?: (id: string) => void;
  /** Rendered width in points; the height follows the 300 × 460 view box. */
  readonly width?: number;
  readonly testID?: string;
}

const [VIEW_WIDTH, VIEW_HEIGHT] = pitchDiagram.viewBox as readonly [number, number];
/** Margin of turf between the edge and the touchline. */
const INSET = 10;

/**
 * Portrait pitch diagram with the fixed pitch roles: night turf, chalk lines and white markers in
 * both schemes (the diagram is always dark). It draws statically (no line-draw animation), so it
 * is the same with reduced motion. One accessible image; the markers are not separate elements.
 */
export function PitchView({
  markers = [],
  accessibilityLabel,
  onMarkerPress,
  width = VIEW_WIDTH,
  testID,
}: PitchViewProps) {
  const theme = useTheme();
  const { colors } = theme;
  const line = {
    stroke: colors.pitchLine,
    strokeWidth: pitchDiagram.lineWidth,
    fill: 'none',
  } as const;
  const left = INSET;
  const top = INSET;
  const right = VIEW_WIDTH - INSET;
  const bottom = VIEW_HEIGHT - INSET;
  const midX = VIEW_WIDTH / 2;
  const midY = VIEW_HEIGHT / 2;
  const { penaltyBox, goalBox } = pitchDiagram;
  const radius = pitchDiagram.markerRadius;
  const bib = theme.typography.bib;
  const caption = theme.typography.caption;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={{ width, aspectRatio: VIEW_WIDTH / VIEW_HEIGHT }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}>
        <Rect x={0} y={0} width={VIEW_WIDTH} height={VIEW_HEIGHT} fill={colors.pitch} />
        <Rect x={left} y={top} width={right - left} height={bottom - top} {...line} />
        <Line x1={left} y1={midY} x2={right} y2={midY} {...line} />
        <Circle cx={midX} cy={midY} r={pitchDiagram.centreCircleRadius} {...line} />
        <Circle cx={midX} cy={midY} r={pitchDiagram.centreSpotRadius} fill={colors.pitchLine} />
        <Rect
          x={midX - penaltyBox.width / 2}
          y={top}
          width={penaltyBox.width}
          height={penaltyBox.depth}
          {...line}
        />
        <Rect
          x={midX - goalBox.width / 2}
          y={top}
          width={goalBox.width}
          height={goalBox.depth}
          {...line}
        />
        <Rect
          x={midX - penaltyBox.width / 2}
          y={bottom - penaltyBox.depth}
          width={penaltyBox.width}
          height={penaltyBox.depth}
          {...line}
        />
        <Rect
          x={midX - goalBox.width / 2}
          y={bottom - goalBox.depth}
          width={goalBox.width}
          height={goalBox.depth}
          {...line}
        />
        {markers.map((marker) => (
          <G
            key={marker.id}
            testID={testID === undefined ? undefined : `${testID}-marker-${marker.id}`}
            onPress={onMarkerPress === undefined ? undefined : () => onMarkerPress(marker.id)}
          >
            {marker.empty === true || marker.number === undefined ? (
              <>
                <Circle
                  cx={marker.x}
                  cy={marker.y}
                  r={radius}
                  fill={colors.pitch}
                  stroke={colors.pitchLine}
                  strokeWidth={pitchDiagram.markerStroke}
                  strokeDasharray={pitchDiagram.emptyMarkerDash}
                />
                <Path
                  d={`M${marker.x} ${marker.y - 7}v14M${marker.x - 7} ${marker.y}h14`}
                  stroke={colors.pitchLine}
                  strokeWidth={pitchDiagram.markerStroke}
                  strokeLinecap="round"
                />
                {marker.emptyLabel === undefined ? null : (
                  <SvgText
                    x={marker.x + radius + 4}
                    y={marker.y + caption.fontSize / 3}
                    fill={colors.onPitch}
                    fontFamily={theme.typography.label.fontFamily}
                    fontSize={11}
                  >
                    {marker.emptyLabel}
                  </SvgText>
                )}
              </>
            ) : (
              <>
                <Circle cx={marker.x} cy={marker.y} r={radius} fill={colors.pitchMarker} />
                <SvgText
                  x={marker.x}
                  y={marker.y + 6.5}
                  textAnchor="middle"
                  fill={colors.onPitchMarker}
                  fontFamily={bib.fontFamily}
                  fontSize={18}
                >
                  {String(marker.number)}
                </SvgText>
              </>
            )}
            {marker.name === undefined ? null : (
              <SvgText
                x={marker.x}
                y={marker.y + radius + 12}
                textAnchor="middle"
                fill={colors.onPitch}
                fontFamily={theme.typography.label.fontFamily}
                fontSize={11}
              >
                {marker.name}
              </SvgText>
            )}
          </G>
        ))}
      </Svg>
    </View>
  );
}
