import type { TextStyle } from 'react-native';

import {
  type BrandThemeColors,
  type ColorSchemeName,
  type RadiusName,
  type SpacingStep,
  type TypeVariant,
  tokens,
} from './tokens';

/**
 * Smallest touch target for every interactive element (Apple HIG 44 pt; Android asks for 48 dp,
 * which the list rows and buttons reach through their padding).
 */
export const MIN_TOUCH_TARGET = 44;

/**
 * Colors used by the UI kit. The brand roles come unchanged from the tokens; `border`, `pressed`
 * and `skeleton` are translucent variants of brand colors (8-digit hex) for non-text decoration,
 * so no new hue enters the palette.
 */
export interface ThemeColors extends BrandThemeColors {
  /** Outline of inputs and cards: muted text color at 45 % opacity. */
  readonly border: string;
  /** Overlay of a pressed row or button: text color at 8 % opacity. */
  readonly pressed: string;
  /** Loading placeholder blocks: muted text color at 20 % opacity. */
  readonly skeleton: string;
  /**
   * Error and alert text. Red Card on the light background; on the dark background red does not
   * reach 4.5:1, so the token contrast pair for dark alerts (Card Yellow on background) is used.
   */
  readonly errorText: string;
}

export type FontWeight = '400' | '500' | '600' | '700';

export interface ThemeTextStyle {
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly lineHeight: number;
  readonly fontWeight: FontWeight;
  readonly fontVariant?: TextStyle['fontVariant'];
}

export interface Theme {
  readonly scheme: ColorSchemeName;
  readonly colors: ThemeColors;
  readonly typography: Readonly<Record<TypeVariant, ThemeTextStyle>>;
  readonly spacing: Readonly<Record<SpacingStep, number>>;
  readonly radius: Readonly<Record<RadiusName, number>>;
  readonly minTouchTarget: number;
}

function withAlpha(hex: string, alpha: number): string {
  const channel = Math.round(alpha * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `${hex}${channel}`;
}

function buildTypography(): Record<TypeVariant, ThemeTextStyle> {
  const entries = Object.entries(tokens.typeScale) as [
    TypeVariant,
    (typeof tokens.typeScale)[TypeVariant],
  ][];
  return Object.fromEntries(
    entries.map(([variant, entry]) => {
      const style: ThemeTextStyle = {
        fontFamily: tokens.fontFamily[entry.family],
        fontSize: entry.size,
        lineHeight: entry.lineHeight,
        fontWeight: String(entry.weight) as FontWeight,
        ...(entry.fontFeature === 'tabular-nums' ? { fontVariant: ['tabular-nums'] } : {}),
      };
      return [variant, style];
    }),
  ) as Record<TypeVariant, ThemeTextStyle>;
}

function buildTheme(scheme: ColorSchemeName): Theme {
  const brand = scheme === 'dark' ? tokens.colorThemes.dark : tokens.colorThemes.light;
  return {
    scheme,
    colors: {
      ...brand,
      border: withAlpha(brand.textMuted, 0.45),
      pressed: withAlpha(brand.text, 0.08),
      skeleton: withAlpha(brand.textMuted, 0.2),
      errorText: scheme === 'dark' ? brand.warning : brand.danger,
    },
    typography: buildTypography(),
    spacing: tokens.spacing,
    radius: tokens.radius,
    minTouchTarget: MIN_TOUCH_TARGET,
  };
}

export const lightTheme: Theme = buildTheme('light');
export const darkTheme: Theme = buildTheme('dark');

/** Dark theme for a dark system appearance; light for light, `unspecified` or unknown. */
export function themeFor(scheme: string | null | undefined): Theme {
  return scheme === 'dark' ? darkTheme : lightTheme;
}
