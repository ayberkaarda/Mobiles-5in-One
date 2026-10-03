import type { TextStyle, ViewStyle } from 'react-native';

import {
  type ColorRoles,
  colors,
  type ColorSchemeName,
  elevation,
  layout,
  motion,
  overlays,
  radius,
  spacing,
  typeScale,
  type TypeVariant,
} from './tokens';

/**
 * Smallest touch target for every interactive element (Apple HIG 44 pt; Android asks for 48 dp,
 * which buttons and inputs reach with the 48 pt control height).
 */
export const MIN_TOUCH_TARGET: number = layout.minTouchTarget;

/** The 29 brand colour roles of the scheme plus its two overlays. */
export interface ThemeColors extends ColorRoles {
  /** Overlay of a pressed row or button (8 % ink on light, 10 % chalk on dark). */
  readonly pressed: string;
  /** Dims the screen behind a sheet or dialog. */
  readonly scrim: string;
}

/**
 * A text style from the native type scale. The family is a static Archivo instance that already
 * carries the weight and width, so no `fontWeight` is set (Android would synthesise a bold).
 */
export interface ThemeTextStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly letterSpacing: number;
  readonly fontVariant?: TextStyle['fontVariant'];
}

export type ThemeSpacing = typeof spacing;
export type ThemeRadius = typeof radius;

export interface Theme {
  readonly scheme: ColorSchemeName;
  readonly colors: ThemeColors;
  readonly typography: Readonly<Record<TypeVariant, ThemeTextStyle>>;
  readonly spacing: ThemeSpacing;
  readonly radius: ThemeRadius;
  /** The one floating level (sheets, sticky actions); cards use a hairline instead. */
  readonly elevation: Readonly<ViewStyle>;
  readonly layout: typeof layout;
  readonly motion: typeof motion;
  readonly minTouchTarget: number;
}

function buildTypography(): Record<TypeVariant, ThemeTextStyle> {
  const entries = Object.entries(typeScale) as [TypeVariant, (typeof typeScale)[TypeVariant]][];
  return Object.fromEntries(
    entries.map(([variant, entry]) => {
      const style: ThemeTextStyle = {
        fontFamily: entry.fontFamily,
        fontSize: entry.fontSize,
        lineHeight: entry.lineHeight,
        letterSpacing: entry.letterSpacing,
        ...(entry.tabularNums ? { fontVariant: ['tabular-nums'] } : {}),
      };
      return [variant, style];
    }),
  ) as Record<TypeVariant, ThemeTextStyle>;
}

const typography = buildTypography();

function buildTheme(scheme: ColorSchemeName): Theme {
  // eslint-disable-next-line security/detect-object-injection -- scheme is a typed ColorScheme
  const shadow = elevation[scheme];
  return {
    scheme,
    colors: {
      // eslint-disable-next-line security/detect-object-injection -- scheme is a typed ColorScheme
      ...colors[scheme],
      // eslint-disable-next-line security/detect-object-injection -- scheme is a typed ColorScheme
      pressed: overlays[scheme].pressed,
      // eslint-disable-next-line security/detect-object-injection -- scheme is a typed ColorScheme
      scrim: overlays[scheme].scrim,
    },
    typography,
    spacing,
    radius,
    elevation: {
      shadowColor: shadow.color,
      shadowOpacity: shadow.opacity,
      shadowRadius: shadow.radius,
      shadowOffset: { width: 0, height: shadow.offsetY },
      elevation: shadow.elevation,
    },
    layout,
    motion,
    minTouchTarget: MIN_TOUCH_TARGET,
  };
}

export const lightTheme: Theme = buildTheme('light');
export const darkTheme: Theme = buildTheme('dark');

/** Dark theme for a dark appearance; light for light, `unspecified` or unknown. */
export function themeFor(scheme: string | null | undefined): Theme {
  return scheme === 'dark' ? darkTheme : lightTheme;
}
