import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { act, render, screen } from '@testing-library/react-native/pure';
import { describe, expect, it } from 'vitest';

import brandTokens from '../../../packages/brand/theme/tokens.json';
import {
  type ColorRole,
  type ColorSchemeName,
  darkTheme,
  FONT_MAP,
  lightTheme,
  navigationTheme,
  statusBarStyle,
  type Theme,
  ThemeProvider,
  themeFor,
  useTheme,
} from '../src/theme';
import { fixedColorRoles, nativeFontFiles, overlays } from '../src/theme/tokens';
import { buttonColors, type ButtonVariant, Text, TONE_ROLE } from '../src/ui';
import { __setColorScheme } from './support/react-native';

interface Pair {
  readonly scheme: 'light' | 'dark' | 'both';
  readonly foreground: string;
  readonly background: string;
}

/** WCAG 2.x relative luminance of `#RRGGBB`. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const [r = 0, g = 0, b = 0] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/** True when the brand lists the pair for this scheme (the brand build checks its ratio). */
function listed(pairs: readonly Pair[], scheme: ColorSchemeName, fg: string, bg: string): boolean {
  return pairs.some(
    (pair) =>
      (pair.scheme === 'both' || pair.scheme === scheme) &&
      pair.foreground === fg &&
      pair.background === bg,
  );
}

const textPairs = brandTokens.contrast.pairs as readonly Pair[];
const nonTextPairs = brandTokens.contrast.nonTextPairs as readonly Pair[];
const themes: readonly Theme[] = [lightTheme, darkTheme];

describe('theme from the v3 brand tokens', () => {
  it('uses the 29 brand colour roles unchanged for both schemes, plus the overlays', () => {
    expect(lightTheme.colors).toMatchObject(brandTokens.color.theme.light);
    expect(darkTheme.colors).toMatchObject(brandTokens.color.theme.dark);
    expect(lightTheme.colors.pressed).toBe(overlays.light.pressed);
    expect(darkTheme.colors.pressed).toBe(overlays.dark.pressed);
    expect(darkTheme.colors.scrim).toBe(overlays.dark.scrim);
  });

  it('keeps the pitch roles fixed: the diagram is dark in both schemes', () => {
    for (const role of fixedColorRoles) {
      expect(lightTheme.colors[role]).toBe(darkTheme.colors[role]);
    }
  });

  it('maps the native type scale onto the static Archivo instances without a font weight', () => {
    expect(lightTheme.typography.body).toEqual({
      fontFamily: 'Archivo-Regular',
      fontSize: 16,
      lineHeight: 24,
      letterSpacing: 0,
    });
    expect(lightTheme.typography.title1).toMatchObject({ fontFamily: 'ArchivoCondensed-Bold' });
    expect(lightTheme.typography.display).toMatchObject({
      fontFamily: 'ArchivoCondensed-ExtraBold',
    });
    for (const variant of ['numeral', 'score', 'bib', 'numeralXL'] as const) {
      expect(lightTheme.typography[variant].fontVariant).toEqual(['tabular-nums']);
    }
    for (const style of Object.values(lightTheme.typography)) {
      expect(style).not.toHaveProperty('fontWeight');
      expect(Object.keys(FONT_MAP)).toContain(style.fontFamily);
    }
  });

  it('loads exactly the five static instances the brand names', () => {
    expect(Object.keys(FONT_MAP).sort()).toEqual(Object.keys(nativeFontFiles).sort());
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed file of this package
    const fontsSource = readFileSync(
      fileURLToPath(new URL('../src/theme/fonts.ts', import.meta.url)),
      'utf8',
    );
    for (const file of Object.values(nativeFontFiles)) {
      expect(fontsSource).toContain(`packages/brand/${file}`);
      const path = fileURLToPath(new URL(`../../../packages/brand/${file}`, import.meta.url));
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- brand token file names
      expect(existsSync(path)).toBe(true);
    }
    expect(fontsSource).not.toMatch(/Variable|Inter|Sora/);
  });

  it('keeps the 4-pt spacing grid and the 4/8/12/20 radii', () => {
    expect(lightTheme.spacing).toEqual(brandTokens.spacing);
    expect(lightTheme.radius).toMatchObject({ xs: 4, sm: 8, md: 12, lg: 20 });
    expect(lightTheme.minTouchTarget).toBe(44);
  });

  it('falls back to the light theme for an unspecified appearance', () => {
    expect(themeFor('unspecified')).toBe(lightTheme);
    expect(themeFor(null)).toBe(lightTheme);
    expect(themeFor('dark')).toBe(darkTheme);
  });
});

describe('contrast of the kit roles (brand pair lists, both schemes)', () => {
  it.each(themes)(
    'every text tone is a listed 4.5:1 pair on the screen grounds ($scheme)',
    (theme) => {
      for (const role of Object.values(TONE_ROLE)) {
        for (const ground of ['background', 'surface', 'surfaceRaised'] as const) {
          expect(listed(textPairs, theme.scheme, role, ground), `${role} on ${ground}`).toBe(true);
          expect(contrast(theme.colors[role], theme.colors[ground])).toBeGreaterThanOrEqual(4.5);
        }
      }
    },
  );

  it.each(themes)('button labels are listed pairs on their fills ($scheme)', (theme) => {
    const roles: Record<ButtonVariant, [ColorRole, ColorRole]> = {
      primary: ['onPrimary', 'primary'],
      accent: ['onAccent', 'accent'],
      danger: ['onDanger', 'danger'],
      secondary: ['text', 'surface'],
    };
    for (const [variant, [fg, bg]] of Object.entries(roles) as [
      ButtonVariant,
      [ColorRole, ColorRole],
    ][]) {
      const colors = buttonColors(theme, variant);
      expect(colors.foreground).toBe(theme.colors[fg]);
      expect(colors.background).toBe(theme.colors[bg]);
      expect(listed(textPairs, theme.scheme, fg, bg), `${variant}`).toBe(true);
    }
    expect(listed(nonTextPairs, theme.scheme, 'borderStrong', 'surface')).toBe(true);
  });

  it.each(themes)(
    'control outlines and the focus ring reach 3:1 on the input well ($scheme)',
    (theme) => {
      for (const role of ['borderStrong', 'focusRing'] as const) {
        expect(listed(nonTextPairs, theme.scheme, role, 'surfaceSunken')).toBe(true);
        expect(contrast(theme.colors[role], theme.colors.surfaceSunken)).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it.each(themes)('the pitch markings are listed pairs on the turf ($scheme)', (theme) => {
    expect(listed(textPairs, theme.scheme, 'onPitch', 'pitch')).toBe(true);
    expect(listed(textPairs, theme.scheme, 'pitchLine', 'pitch')).toBe(true);
    expect(listed(textPairs, theme.scheme, 'onPitchMarker', 'pitchMarker')).toBe(true);
  });
});

describe('navigation chrome and status bar', () => {
  it.each(themes)('follow the resolved scheme ($scheme)', (theme) => {
    const navigation = navigationTheme(theme);
    expect(navigation.dark).toBe(theme.scheme === 'dark');
    expect(navigation.colors.background).toBe(theme.colors.background);
    expect(navigation.colors.card).toBe(theme.colors.surface);
    expect(navigation.colors.text).toBe(theme.colors.text);
    // Active tab: `primaryText` on light, `text` on dark; both listed 4.5:1 on the bar.
    const activeRole: ColorRole = theme.scheme === 'dark' ? 'text' : 'primaryText';
    expect(navigation.colors.primary).toBe(theme.colors[activeRole]);
    expect(listed(textPairs, theme.scheme, activeRole, 'surface')).toBe(true);
    expect(navigation.fonts.regular.fontFamily).toBe('Archivo-Regular');
    expect(statusBarStyle(theme)).toBe(theme.scheme === 'dark' ? 'light' : 'dark');
  });
});

describe('ThemeProvider', () => {
  function SchemeProbe() {
    return <Text>{useTheme().scheme}</Text>;
  }

  it('follows the system appearance as it changes', async () => {
    __setColorScheme('light');
    await render(
      <ThemeProvider>
        <SchemeProbe />
      </ThemeProvider>,
    );
    expect(screen.getByText('light')).toBeTruthy();
    await act(async () => {
      __setColorScheme('dark');
    });
    expect(screen.getByText('dark')).toBeTruthy();
    __setColorScheme('light');
  });
});
