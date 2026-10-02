import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { useFonts } from 'expo-font';
import {
  type ErrorBoundaryProps,
  ThemeProvider as NavigationThemeProvider,
  SplashScreen,
  Stack,
} from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { useStore } from 'zustand';
import { I18nextProvider } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { session } from '../src/api/instance';
import { authStore, routeAccess, useAuthStatus } from '../src/auth-store';
import { errorMessage } from '../src/i18n/error-copy';
import { i18n } from '../src/i18n/instance';
import {
  cacheBusterFor,
  clearQueryCaches,
  connectFocusManager,
  createQueryClient,
  createQueryPersister,
  QueryProvider,
} from '../src/query';
import { FONT_MAP, navigationTheme, ThemeProvider, useTheme } from '../src/theme';
import { ErrorState } from '../src/ui';

void SplashScreen.preventAutoHideAsync();
connectFocusManager();

const queryClient = createQueryClient();
const queryPersister = createQueryPersister(AsyncStorage);
const appVersion = Constants.expoConfig?.version ?? 'dev';
// Registered before the session is read, so even the start-up check clears a stale cache.
session.onSignOut(() => clearQueryCaches(queryClient, queryPersister));

/** Last-resort screen for a render error outside every screen boundary. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <ThemeProvider>
      <ErrorState
        title={i18n.t('common:state.errorTitle')}
        message={errorMessage(i18n, error)}
        retry={{ label: i18n.t('common:state.retry'), onPress: () => void retry() }}
      />
    </ThemeProvider>
  );
}

function RootStack() {
  const theme = useTheme();
  const access = routeAccess(useAuthStatus());
  return (
    <NavigationThemeProvider value={navigationTheme(theme)}>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={access.signedInRoutes}>
          <Stack.Screen name="(tabs)" />
          {/* Team screens open above the tabs; an invite link (`/mac/<code>`) needs a session. */}
          <Stack.Screen name="takim/yeni" />
          <Stack.Screen name="takim/katil" />
          <Stack.Screen name="takim/[id]/index" />
          <Stack.Screen name="takim/[id]/davet" />
          <Stack.Screen name="takim/[id]/uye/[userId]" />
          <Stack.Screen name="mac/[code]" />
          {/* Match screens live under their team; a guest reaches them through the match id. */}
          <Stack.Screen name="takim/[id]/mac/index" />
          <Stack.Screen name="takim/[id]/mac/yeni" />
          <Stack.Screen name="takim/[id]/mac/[matchId]/index" />
          <Stack.Screen name="takim/[id]/mac/[matchId]/duzenle" />
          <Stack.Screen name="takim/[id]/mac/[matchId]/dizilis" />
          <Stack.Screen name="takim/[id]/mac/[matchId]/odemeler" />
          {/* Open calls: a call opened from the Eksik Var list, and the call of a match (staff). */}
          <Stack.Screen name="ilan/[id]" />
          <Stack.Screen name="ilan/mac/[matchId]" />
          {/* Venue directory: a venue (`/saha/<slug>`, the app-link path) and the add form. */}
          <Stack.Screen name="saha/[slug]" />
          <Stack.Screen name="saha/yeni" />
        </Stack.Protected>
        {/* Signed-out side: the entry screen and the (auth) group. */}
        <Stack.Protected guard={access.signedOutRoutes}>
          <Stack.Screen name="index" />
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        {/* Email links open in any session state; the tokens they carry are single use. */}
        <Stack.Screen name="e-posta-dogrula" />
        <Stack.Screen name="sifre-sifirla" />
      </Stack>
    </NavigationThemeProvider>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(FONT_MAP);
  const status = useAuthStatus();
  // The persisted cache belongs to one sign-in; another sign-in (or none) restores nothing.
  const cacheBuster = cacheBusterFor(
    appVersion,
    useStore(authStore, (state) => state.cacheScope),
  );

  useEffect(() => {
    session.bootstrap().catch(() => {
      // Secure storage unreadable: continue signed out rather than keep the splash up forever.
      void session.signOut({ revokeRemote: false, reason: 'expired' });
    });
  }, []);

  // A font that fails to load falls back to the system face; it never blocks the app.
  const ready = (fontsLoaded || fontError !== null) && routeAccess(status).pending === false;

  useEffect(() => {
    if (ready) {
      void SplashScreen.hideAsync();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nextProvider i18n={i18n}>
            <QueryProvider
              key={cacheBuster}
              client={queryClient}
              persister={queryPersister}
              cacheBuster={cacheBuster}
            >
              <RootStack />
            </QueryProvider>
          </I18nextProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
