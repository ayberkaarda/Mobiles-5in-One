import { type Theme as NavigationTheme } from 'expo-router';

import { type Theme } from './theme';

/** Navigator chrome (headers, tab bar, screen background) in brand colors and fonts. */
export function navigationTheme(theme: Theme): NavigationTheme {
  const { colors, typography } = theme;
  const body = typography.body.fontFamily;
  return {
    dark: theme.scheme === 'dark',
    colors: {
      // Active tab tint: Pitch Green on the light bar; on the dark bar it would fall below 4.5:1,
      // so the light text color marks the active tab there.
      primary: theme.scheme === 'dark' ? colors.text : colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.accent,
    },
    fonts: {
      regular: { fontFamily: body, fontWeight: '400' },
      medium: { fontFamily: body, fontWeight: '500' },
      bold: { fontFamily: body, fontWeight: '600' },
      heavy: { fontFamily: typography.title1.fontFamily, fontWeight: '700' },
    },
  };
}
