import { act, render, screen } from '@testing-library/react-native/pure';
import { describe, expect, it } from 'vitest';

import brandTokens from '../../../packages/brand/tokens.json';
import {
  darkTheme,
  lightTheme,
  navigationTheme,
  ThemeProvider,
  themeFor,
  useTheme,
} from '../src/theme';
import { Text } from '../src/ui';
import { __setColorScheme } from './support/react-native';

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

describe('theme from @kadro/brand tokens', () => {
  it('uses the brand color roles unchanged for both schemes', () => {
    expect(lightTheme.colors).toMatchObject(brandTokens.color.theme.light);
    expect(darkTheme.colors).toMatchObject(brandTokens.color.theme.dark);
  });

  it('maps the type scale with the brand families and tabular score digits', () => {
    expect(lightTheme.typography.body).toMatchObject({
      fontFamily: 'Inter',
      fontSize: 16,
      lineHeight: 24,
      fontWeight: '400',
    });
    expect(lightTheme.typography.title1).toMatchObject({ fontFamily: 'Sora', fontWeight: '700' });
    expect(lightTheme.typography.score.fontVariant).toEqual(['tabular-nums']);
  });

  it('keeps the 4-pt spacing grid and the 8/12/20 radii', () => {
    expect(lightTheme.spacing).toEqual(brandTokens.spacing);
    expect(lightTheme.radius).toMatchObject({ sm: 8, md: 12, lg: 20 });
  });

  it.each([lightTheme, darkTheme])(
    'gives every text tone at least 4.5:1 on background and surface ($scheme)',
    (theme) => {
      const { colors } = theme;
      for (const foreground of [colors.text, colors.textMuted, colors.link, colors.errorText]) {
        for (const background of [colors.background, colors.surface]) {
          expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
        }
      }
      const navigation = navigationTheme(theme);
      expect(contrast(String(navigation.colors.primary), colors.surface)).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );

  it('falls back to the light theme for an unspecified appearance', () => {
    expect(themeFor('unspecified')).toBe(lightTheme);
    expect(themeFor(null)).toBe(lightTheme);
    expect(themeFor('dark')).toBe(darkTheme);
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
