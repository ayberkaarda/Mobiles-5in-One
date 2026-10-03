import { type StyleProp, type TextStyle, View } from 'react-native';
import Svg, { Text as SvgText } from 'react-native-svg';

import { useTheme } from '../theme';
import { Text, type TextTone, TONE_ROLE } from './Text';

/** Numeric steps of the type scale (condensed Archivo, tabular figures). */
export type NumeralVariant = 'numeral' | 'score' | 'bib' | 'numeralXL';

export interface NumeralProps {
  readonly value: string | number;
  /** `numeral` 24 (times, counts in rows), `score` 40, `bib` 28 (kit numbers), `numeralXL` 64. */
  readonly variant?: NumeralVariant;
  readonly tone?: TextTone;
  /**
   * Outlined figure with no body: the "eksik" count (`2` eksik). Drawn as an SVG outline; the
   * spoken text stays `value` (or `accessibilityLabel`).
   */
  readonly outlined?: boolean;
  /** Spoken text when the figure alone is not enough, e.g. "13 / 14 oyuncu geliyor". */
  readonly accessibilityLabel?: string;
  readonly testID?: string;
  readonly style?: StyleProp<TextStyle>;
}

/** Width of one condensed tabular figure, as a share of the font size (generous for the box). */
const FIGURE_ADVANCE = 0.6;

/**
 * Kit-number figure: counts (13/14), kick-off times, fees and scores in the condensed heavy
 * width with tabular digits.
 */
export function Numeral({
  value,
  variant = 'numeral',
  tone = 'default',
  outlined = false,
  accessibilityLabel,
  testID,
  style,
}: NumeralProps) {
  const theme = useTheme();
  const text = String(value);
  if (!outlined) {
    return (
      <Text
        variant={variant}
        tone={tone}
        tabular
        accessibilityLabel={accessibilityLabel}
        testID={testID}
        style={style}
      >
        {text}
      </Text>
    );
  }
  // eslint-disable-next-line security/detect-object-injection -- variant is a typed NumeralVariant
  const type = theme.typography[variant];
  // eslint-disable-next-line security/detect-object-injection -- tone is a typed TextTone
  const stroke = theme.colors[TONE_ROLE[tone]];
  const strokeWidth = Math.max(1, Math.round(type.fontSize / 32));
  const width = Math.ceil(text.length * type.fontSize * FIGURE_ADVANCE + strokeWidth * 2);
  const height = type.lineHeight;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={accessibilityLabel ?? text}
      testID={testID}
    >
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <SvgText
          x={width / 2}
          y={height - (height - type.fontSize) / 2 - type.fontSize * 0.14}
          textAnchor="middle"
          fontFamily={type.fontFamily}
          fontSize={type.fontSize}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
        >
          {text}
        </SvgText>
      </Svg>
    </View>
  );
}
