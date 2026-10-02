import { render } from '@testing-library/react-native/pure';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type i18n as I18n } from 'i18next';
import { type ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';

import { ThemeProvider } from '../../src/theme';
import { type ColorSchemeName } from '../../src/theme/tokens';
import { createTestI18n } from './i18n';

export interface ProviderOptions {
  readonly i18n?: I18n;
  readonly queryClient?: QueryClient;
  readonly scheme?: ColorSchemeName;
}

/** A query client for one test: no retries, nothing kept between tests. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity, networkMode: 'always' },
      mutations: { retry: false },
    },
  });
}

/** Renders inside the app providers: theme, translations (Turkish by default) and queries. */
export function renderWithProviders(ui: ReactElement, options: ProviderOptions = {}) {
  const i18n = options.i18n ?? createTestI18n();
  const queryClient = options.queryClient ?? createTestQueryClient();
  return render(
    <ThemeProvider scheme={options.scheme}>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
      </I18nextProvider>
    </ThemeProvider>,
  );
}
