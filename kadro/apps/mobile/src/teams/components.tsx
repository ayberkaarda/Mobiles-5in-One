import { useRouter } from 'expo-router';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ApiError } from '../api/errors';
import { errorMessage } from '../i18n/error-copy';
import { useTheme } from '../theme';
import { Button, type ButtonVariant, Card, ErrorState, Screen, SkeletonList, Text } from '../ui';

/** Where "back" leads when the screen was opened directly (deep link, cold start). */
export const TEAMS_HOME = '/takimlar';

/** Back control of the pushed team screens: the previous screen, else the teams tab. */
export function BackLink() {
  const { t } = useTranslation('teams');
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('nav.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(TEAMS_HOME))}
      testID="back"
      style={{
        minHeight: theme.minTouchTarget,
        justifyContent: 'center',
        alignSelf: 'flex-start',
        paddingHorizontal: theme.spacing['4'],
      }}
    >
      <Text tone="link" variant="label">
        {`‹ ${t('nav.back')}`}
      </Text>
    </Pressable>
  );
}

/** Page frame of a pushed team screen: back control, heading, scrolling content. */
export function TeamScreen({
  title,
  children,
  testID,
}: {
  readonly title?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const theme = useTheme();
  return (
    <Screen scroll testID={testID}>
      <BackLink />
      {title === undefined ? null : (
        <Text
          variant="title1"
          style={{ paddingHorizontal: theme.spacing['4'], paddingBottom: theme.spacing['3'] }}
        >
          {title}
        </Text>
      )}
      {children}
    </Screen>
  );
}

/** Horizontal padding of screen content. */
export function Section({ children }: { readonly children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ paddingHorizontal: theme.spacing['4'], marginBottom: theme.spacing['4'] }}>
      {children}
    </View>
  );
}

/** Short explanation on a card (read-only team, unverified email, captain cannot leave). */
export function Notice({
  children,
  testID,
}: {
  readonly children: string;
  readonly testID?: string;
}) {
  return (
    <Card testID={testID}>
      <Text variant="footnote" tone="muted">
        {children}
      </Text>
    </Card>
  );
}

/** Loading and failure of a screen that shows one resource. */
export function ResourceState({
  status,
  error,
  onRetry,
  missingTitle,
  missingMessage,
  testID,
}: {
  readonly status: 'pending' | 'error';
  readonly error: unknown;
  readonly onRetry: () => void;
  /** Copy for a 404: the resource is gone or the user no longer has access; retry is pointless. */
  readonly missingTitle: string;
  readonly missingMessage: string;
  readonly testID?: string;
}) {
  const { t, i18n } = useTranslation('common');
  if (status === 'pending') {
    return (
      <SkeletonList
        accessibilityLabel={t('state.loading')}
        rows={3}
        testID={testID && `${testID}-loading`}
      />
    );
  }
  if (error instanceof ApiError && error.status === 404) {
    return (
      <ErrorState
        title={missingTitle}
        message={missingMessage}
        testID={testID && `${testID}-missing`}
      />
    );
  }
  return (
    <ErrorState
      title={t('state.errorTitle')}
      message={errorMessage(i18n, error)}
      requestId={error instanceof ApiError ? (error.requestId ?? undefined) : undefined}
      referenceLabel={t('state.reference')}
      retry={{ label: t('state.retry'), onPress: onRetry }}
      testID={testID && `${testID}-error`}
    />
  );
}

/** "Showing saved data" line above content kept from the cache after a failed refresh. */
export function CachedNotice({ visible }: { readonly visible: boolean }) {
  const { t } = useTranslation('common');
  const theme = useTheme();
  if (!visible) {
    return null;
  }
  return (
    <Text
      variant="footnote"
      tone="muted"
      accessibilityLiveRegion="polite"
      testID="cached-notice"
      style={{ paddingHorizontal: theme.spacing['4'], paddingBottom: theme.spacing['3'] }}
    >
      {t('state.showingCached')}
    </Text>
  );
}

/**
 * A destructive or far-reaching action in two steps: the first press shows what will happen and
 * asks again; nothing is sent before "confirm". The question is announced as an alert.
 */
export function ConfirmAction({
  label,
  question,
  confirmLabel,
  cancelLabel,
  onConfirm,
  busy = false,
  disabled = false,
  variant = 'secondary',
  testID,
}: {
  readonly label: string;
  readonly question: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  readonly variant?: ButtonVariant;
  readonly testID?: string;
}) {
  const theme = useTheme();
  const [asking, setAsking] = useState(false);
  if (!asking) {
    return (
      <Button
        label={label}
        variant={variant}
        loading={busy}
        disabled={disabled}
        onPress={() => setAsking(true)}
        testID={testID}
        style={{ marginBottom: theme.spacing['3'] }}
      />
    );
  }
  return (
    <Card style={{ marginBottom: theme.spacing['3'] }} testID={testID && `${testID}-confirm`}>
      <Text accessibilityRole="alert" accessibilityLiveRegion="assertive">
        {question}
      </Text>
      <Button
        label={confirmLabel}
        variant="danger"
        disabled={disabled}
        onPress={() => {
          setAsking(false);
          onConfirm();
        }}
        style={{ marginTop: theme.spacing['3'] }}
      />
      <Button
        label={cancelLabel}
        variant="secondary"
        onPress={() => setAsking(false)}
        style={{ marginTop: theme.spacing['2'] }}
      />
    </Card>
  );
}
