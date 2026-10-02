import { FlashList } from '@shopify/flash-list';
import { type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { ApiError } from '../api/errors';
import { errorMessage } from '../i18n/error-copy';
import { useTheme } from '../theme';
import { EmptyState, ErrorState, SkeletonList, type StateAction, Text } from '../ui';

export interface ListQueryState {
  readonly status: 'pending' | 'error' | 'success';
  readonly error: unknown;
  readonly isRefetching: boolean;
  readonly refetch: () => unknown;
  readonly hasNextPage?: boolean;
  readonly isFetchingNextPage?: boolean;
  readonly fetchNextPage?: () => unknown;
}

export interface ListQueryViewProps<T> {
  readonly query: ListQueryState;
  readonly items: readonly T[];
  readonly renderItem: (item: T) => ReactElement;
  readonly keyExtractor: (item: T) => string;
  readonly empty: {
    readonly title: string;
    readonly message: string;
    readonly action?: StateAction;
  };
  readonly testID?: string;
}

/**
 * Loading, error, empty and data states of a server list, in that order of precedence:
 * - first load: skeleton rows;
 * - failure with nothing cached: localized error with retry;
 * - failure with cached rows (offline, persisted cache): the rows plus a notice;
 * - success without rows: the empty state.
 */
export function ListQueryView<T>({
  query,
  items,
  renderItem,
  keyExtractor,
  empty,
  testID,
}: ListQueryViewProps<T>) {
  const { t, i18n } = useTranslation('common');
  const theme = useTheme();
  const retry: StateAction = { label: t('state.retry'), onPress: () => void query.refetch() };

  if (items.length === 0) {
    if (query.status === 'pending') {
      return (
        <SkeletonList
          accessibilityLabel={t('state.loading')}
          testID={testID && `${testID}-loading`}
        />
      );
    }
    if (query.status === 'error') {
      return (
        <ErrorState
          title={t('state.errorTitle')}
          message={errorMessage(i18n, query.error)}
          requestId={
            query.error instanceof ApiError ? (query.error.requestId ?? undefined) : undefined
          }
          referenceLabel={t('state.reference')}
          retry={retry}
          testID={testID && `${testID}-error`}
        />
      );
    }
    return (
      <EmptyState
        title={empty.title}
        message={empty.message}
        action={empty.action}
        testID={testID && `${testID}-empty`}
      />
    );
  }

  return (
    <FlashList
      testID={testID}
      data={items}
      keyExtractor={keyExtractor}
      renderItem={({ item }) => renderItem(item)}
      ItemSeparatorComponent={() => (
        <View style={{ height: 1, backgroundColor: theme.colors.border }} />
      )}
      ListHeaderComponent={
        query.status === 'error' ? (
          <Text
            variant="footnote"
            tone="muted"
            accessibilityLiveRegion="polite"
            style={{ paddingHorizontal: theme.spacing['4'], paddingBottom: theme.spacing['2'] }}
          >
            {t('state.showingCached')}
          </Text>
        ) : null
      }
      refreshing={query.isRefetching && query.isFetchingNextPage !== true}
      onRefresh={() => void query.refetch()}
      onEndReached={() => {
        if (query.hasNextPage === true && query.isFetchingNextPage !== true) {
          void query.fetchNextPage?.();
        }
      }}
      onEndReachedThreshold={0.5}
    />
  );
}
