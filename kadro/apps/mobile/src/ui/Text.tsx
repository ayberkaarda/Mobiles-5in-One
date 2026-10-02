import { type ReactNode } from 'react';
import {
  type StyleProp,
  Text as RNText,
  type TextProps as RNTextProps,
  type TextStyle,
} from 'react-native';

import { useTheme, type ThemeColors, type TypeVariant } from '../theme';

/**
 * Text color roles that meet 4.5:1 on the background and surface of both schemes (token contrast
 * pairs). Pitch Green is not offered as a text tone: in the dark scheme it falls below 4.5:1,
 * so emphasized links use `link`.
 */
export type TextTone = 'default' | 'muted' | 'danger' | 'link';

export interface TextProps extends Omit<RNTextProps, 'style'> {
  readonly children: ReactNode;
  readonly variant?: TypeVariant;
  readonly tone?: TextTone;
  /** Fixed-width digits for scores, fees, times and counts (brand rule `tabular-nums`). */
  readonly tabular?: boolean;
  readonly align?: TextStyle['textAlign'];
  readonly style?: StyleProp<TextStyle>;
}

const TONE_COLOR: Record<TextTone, keyof ThemeColors> = {
  default: 'text',
  muted: 'textMuted',
  danger: 'errorText',
  link: 'link',
};

const HEADER_VARIANTS: ReadonlySet<TypeVariant> = new Set([
  'title1',
  'title2',
  'title3',
  'display',
]);

/**
 * Brand text. Title variants are announced as headers; font scaling stays enabled (dynamic type).
 */
export function Text({
  children,
  variant = 'body',
  tone = 'default',
  tabular = false,
  align,
  style,
  accessibilityRole,
  ...rest
}: TextProps) {
  const theme = useTheme();
  // eslint-disable-next-line security/detect-object-injection -- variant is a typed TypeVariant
  const typography = theme.typography[variant];
  // eslint-disable-next-line security/detect-object-injection -- tone is a typed TextTone
  const color = theme.colors[TONE_COLOR[tone]];
  const role = accessibilityRole ?? (HEADER_VARIANTS.has(variant) ? 'header' : undefined);
  return (
    <RNText
      {...rest}
      accessibilityRole={role}
      style={[
        typography,
        { color },
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        align === undefined ? null : { textAlign: align },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}
