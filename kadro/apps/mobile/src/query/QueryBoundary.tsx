import { QueryErrorResetBoundary } from '@tanstack/react-query';
import { Component, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../api/errors';
import { errorMessage } from '../i18n/error-copy';
import { ErrorState } from '../ui';

interface BoundaryProps {
  readonly children: ReactNode;
  readonly onReset: () => void;
  readonly fallback: (error: unknown, retry: () => void) => ReactNode;
}

interface BoundaryState {
  readonly error: unknown;
  readonly failed: boolean;
}

class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, failed: false };

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error, failed: true };
  }

  private readonly retry = (): void => {
    this.props.onReset();
    this.setState({ error: null, failed: false });
  };

  override render(): ReactNode {
    if (this.state.failed) {
      return this.props.fallback(this.state.error, this.retry);
    }
    return this.props.children;
  }
}

function BoundaryFallback({ error, retry }: { error: unknown; retry: () => void }) {
  const { t, i18n } = useTranslation('common');
  return (
    <ErrorState
      title={t('state.errorTitle')}
      message={errorMessage(i18n, error)}
      requestId={error instanceof ApiError ? (error.requestId ?? undefined) : undefined}
      referenceLabel={t('state.reference')}
      retry={{ label: t('state.retry'), onPress: retry }}
    />
  );
}

/**
 * Catches errors thrown while rendering a screen (including queries using `throwOnError`) and
 * shows a localized error with a retry that also resets the failed queries.
 */
export function QueryBoundary({ children }: { readonly children: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary
          onReset={reset}
          fallback={(error, retry) => <BoundaryFallback error={error} retry={retry} />}
        >
          {children}
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
