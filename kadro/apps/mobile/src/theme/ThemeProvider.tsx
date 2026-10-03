import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { useStore } from 'zustand';

import { colorPreference as appColorPreference } from './instance';
import { type ColorPreferenceStore, resolveColorScheme } from './preference';
import { lightTheme, type Theme, themeFor } from './theme';
import { type ColorPreference, type ColorSchemeName } from './tokens';

const ThemeContext = createContext<Theme>(lightTheme);
const PreferenceContext = createContext<ColorPreferenceStore>(appColorPreference);

interface ThemeProviderProps {
  readonly children: ReactNode;
  /** Forces a scheme (tests, previews); by default the stored preference decides. */
  readonly scheme?: ColorSchemeName;
  /** Preference store; the app's device-stored one by default. */
  readonly preference?: ColorPreferenceStore;
}

/**
 * Resolves the stored preference (Sistem / Açık / Koyu) against the device appearance:
 * `system` follows `useColorScheme()` as it changes, `light` and `dark` pin the scheme.
 */
export function ThemeProvider({
  children,
  scheme,
  preference = appColorPreference,
}: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const chosen = useStore(preference.store, (state) => state.preference);
  const theme = themeFor(scheme ?? resolveColorScheme(chosen, systemScheme));
  return (
    <PreferenceContext.Provider value={preference}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </PreferenceContext.Provider>
  );
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export interface ColorPreferenceControl {
  /** What the user picked: `system`, `light` or `dark`. */
  readonly preference: ColorPreference;
  /** The scheme rendered now. */
  readonly scheme: ColorSchemeName;
  readonly choose: (preference: ColorPreference) => void;
}

/** The colour scheme setting for Ayarlar: the current choice and a way to change it. */
export function useColorPreference(): ColorPreferenceControl {
  const store = useContext(PreferenceContext);
  const preference = useStore(store.store, (state) => state.preference);
  const { scheme } = useTheme();
  return useMemo(
    () => ({ preference, scheme, choose: (next) => void store.choose(next) }),
    [preference, scheme, store],
  );
}
