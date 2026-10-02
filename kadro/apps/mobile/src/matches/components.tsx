import { useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, View } from 'react-native';

import { ApiError } from '../api/errors';
import { errorMessage } from '../i18n/error-copy';
import { useTheme } from '../theme';
import { ErrorState, Screen, Text } from '../ui';

/** Where "back" leads when a match screen was opened directly (deep link, cold start). */
export const MATCHES_HOME = '/maclar';

export function teamMatchesHref(teamId: string): string {
  return `/takim/${encodeURIComponent(teamId)}/mac`;
}

export function matchHref(teamId: string, matchId: string, screen?: string): string {
  const base = `${teamMatchesHref(teamId)}/${encodeURIComponent(matchId)}`;
  return screen === undefined ? base : `${base}/${screen}`;
}

/** Back control of the pushed match screens: the previous screen, else `fallback`. */
function BackLink({ fallback }: { readonly fallback: string }) {
  const { t } = useTranslation('matches');
  const theme = useTheme();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('nav.back')}
      onPress={() => (router.canGoBack() ? router.back() : router.replace(fallback))}
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

/** Page frame of a pushed match screen: back control, heading, scrolling content. */
export function MatchScreen({
  title,
  subtitle,
  back = MATCHES_HOME,
  scroll = true,
  children,
  testID,
}: {
  readonly title?: string;
  readonly subtitle?: string;
  /** Destination of "back" when there is no previous screen. */
  readonly back?: string;
  /** `false` when the content is a virtualized list that scrolls by itself. */
  readonly scroll?: boolean;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const theme = useTheme();
  return (
    <Screen scroll={scroll} testID={testID}>
      <BackLink fallback={back} />
      {title === undefined ? null : (
        <Text
          variant="title1"
          style={{ paddingHorizontal: theme.spacing['4'], paddingBottom: theme.spacing['1'] }}
        >
          {title}
        </Text>
      )}
      {subtitle === undefined ? null : (
        <Text
          tone="muted"
          style={{ paddingHorizontal: theme.spacing['4'], paddingBottom: theme.spacing['3'] }}
        >
          {subtitle}
        </Text>
      )}
      {children}
    </Screen>
  );
}

/** Heading of a block on a match screen. */
export function SectionTitle({ children }: { readonly children: string }) {
  const theme = useTheme();
  return (
    <Text
      variant="title3"
      accessibilityRole="header"
      style={{ paddingHorizontal: theme.spacing['4'], marginBottom: theme.spacing['2'] }}
    >
      {children}
    </Text>
  );
}

export interface ChoiceOption<T extends string> {
  readonly value: T;
  readonly label: string;
  /** Spoken name when the visible label alone is not enough (e.g. "Ali: A takımı"). */
  readonly accessibilityLabel?: string;
  readonly disabled?: boolean;
}

/**
 * A single choice among a few options (RSVP, format, venue kind, lineup side): each option is a
 * radio button of at least 44 pt, the selected one is announced as checked. Tapping is the only
 * interaction; there is no drag and drop.
 */
export function ChoiceGroup<T extends string>({
  label,
  options,
  selected,
  onSelect,
  disabled = false,
  testID,
}: {
  /** Spoken name of the group. */
  readonly label: string;
  readonly options: readonly ChoiceOption<T>[];
  readonly selected: T | null;
  readonly onSelect: (value: T) => void;
  readonly disabled?: boolean;
  readonly testID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={testID}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing['2'] }}
    >
      {options.map((option) => {
        const checked = option.value === selected;
        const inactive = disabled || option.disabled === true;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={option.accessibilityLabel ?? option.label}
            accessibilityState={{ checked, disabled: inactive }}
            disabled={inactive}
            onPress={() => onSelect(option.value)}
            testID={testID && `${testID}-${option.value}`}
            style={{
              minHeight: theme.minTouchTarget,
              minWidth: theme.minTouchTarget,
              justifyContent: 'center',
              alignItems: 'center',
              paddingHorizontal: theme.spacing['4'],
              borderRadius: theme.radius.md,
              borderWidth: 1,
              borderColor: checked ? theme.colors.primary : theme.colors.border,
              backgroundColor: checked ? theme.colors.primary : theme.colors.surface,
              opacity: inactive && !checked ? 0.5 : 1,
            }}
          >
            <Text
              variant="label"
              style={{ color: checked ? theme.colors.onPrimary : theme.colors.text }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A label and its value on one line, read as one element ("Ücret: ₺1.500"). */
export function Fact({
  label,
  value,
  testID,
}: {
  readonly label: string;
  readonly value: string;
  readonly testID?: string;
}) {
  const theme = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      testID={testID}
      style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.spacing['3'] }}
    >
      <Text tone="muted">{label}</Text>
      <Text tabular style={{ flexShrink: 1 }} align="right">
        {value}
      </Text>
    </View>
  );
}

/**
 * The viewer's team role could not be loaded (offline without a saved team, server error). Staff
 * controls depend on it, so instead of hiding them as if the viewer had no right, the screen says
 * so and offers a retry.
 */
export function RoleError({
  error,
  onRetry,
}: {
  readonly error: unknown;
  readonly onRetry: () => void;
}) {
  const { t, i18n } = useTranslation('matches');
  const { t: tc } = useTranslation('common');
  return (
    <ErrorState
      title={t('role.errorTitle')}
      message={errorMessage(i18n, error)}
      requestId={error instanceof ApiError ? (error.requestId ?? undefined) : undefined}
      referenceLabel={tc('state.reference')}
      retry={{ label: tc('state.retry'), onPress: onRetry }}
      testID="role-error"
    />
  );
}
