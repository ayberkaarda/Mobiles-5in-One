import { type Theme as NavigationTheme } from 'expo-router';

import { type Theme } from './theme';

/**
 * Navigator chrome (headers, tab bar, screen background) for the resolved scheme. Fonts are the
 * static Archivo instances, so the weight stays `normal` (the family already carries it).
 */
export function navigationTheme(theme: Theme): NavigationTheme {
  const { colors, typography } = theme;
  return {
    dark: theme.scheme === 'dark',
    colors: {
      // Active tab tint: green as text on light (`primaryText`), chalk text on dark.
      primary: theme.scheme === 'dark' ? colors.text : colors.primaryText,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.accent,
    },
    fonts: {
      regular: { fontFamily: typography.body.fontFamily, fontWeight: 'normal' },
      medium: { fontFamily: typography.caption.fontFamily, fontWeight: 'normal' },
      bold: { fontFamily: typography.bodyStrong.fontFamily, fontWeight: 'normal' },
      heavy: { fontFamily: typography.title2.fontFamily, fontWeight: 'normal' },
    },
  };
}

/** Status bar content for the resolved scheme: light glyphs on the dark scheme. */
export function statusBarStyle(theme: Theme): 'light' | 'dark' {
  return theme.scheme === 'dark' ? 'light' : 'dark';
}
