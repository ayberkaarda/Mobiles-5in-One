'use client';

import { createContext, type ReactNode, useContext } from 'react';

import { DEFAULT_THEME_PREFERENCE, type ThemePreference } from './theme';

/**
 * The colour-scheme preference the root layout read from the `kadro-theme` cookie, handed to
 * client components (the footer toggle marks the current choice with it during the server render).
 * Without a provider the value is `system`.
 */
const ThemePreferenceContext = createContext<ThemePreference>(DEFAULT_THEME_PREFERENCE);

export function ThemePreferenceProvider({
  value,
  children,
}: {
  readonly value: ThemePreference;
  readonly children: ReactNode;
}) {
  return <ThemePreferenceContext value={value}>{children}</ThemePreferenceContext>;
}

export function useThemePreference(): ThemePreference {
  return useContext(ThemePreferenceContext);
}
