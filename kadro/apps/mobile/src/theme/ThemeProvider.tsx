import { createContext, type ReactNode, useContext } from 'react';
import { useColorScheme } from 'react-native';

import { lightTheme, type Theme, themeFor } from './theme';
import { type ColorSchemeName } from './tokens';

const ThemeContext = createContext<Theme>(lightTheme);

interface ThemeProviderProps {
  readonly children: ReactNode;
  /** Forces a scheme (tests, previews); by default the system appearance is followed. */
  readonly scheme?: ColorSchemeName;
}

/** Follows the system light / dark appearance (`userInterfaceStyle: automatic`). */
export function ThemeProvider({ children, scheme }: ThemeProviderProps) {
  const systemScheme = useColorScheme();
  const theme = themeFor(scheme ?? systemScheme);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
