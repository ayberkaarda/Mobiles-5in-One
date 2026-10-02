import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, View } from 'react-native';

import { ApiError } from '../api/errors';
import { errorMessage } from '../i18n/error-copy';
import { useTheme } from '../theme';
import { Button, Screen, Text, TextField, type TextFieldProps } from '../ui';
import { type ProviderOutcome, type ProviderSignIn } from './providers';
import { useAsyncAction } from './use-async-action';
import { VALIDATION_PARAMS } from './validation';

/** Page frame of every auth screen: scrolling form that moves above the keyboard. */
export function AuthScreen({
  title,
  subtitle,
  children,
  testID,
}: {
  readonly title: string;
  readonly subtitle?: string;
  readonly children: ReactNode;
  readonly testID?: string;
}) {
  const theme = useTheme();
  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen title={title} scroll testID={testID}>
        <View style={{ paddingHorizontal: theme.spacing['4'] }}>
          {subtitle === undefined ? null : (
            <Text tone="muted" style={{ marginBottom: theme.spacing['5'] }}>
              {subtitle}
            </Text>
          )}
          {children}
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

/** Failure of a submit: localized copy from the error catalog, announced as an alert. */
export function FormError({ error }: { readonly error: unknown }) {
  const { t, i18n } = useTranslation('auth');
  const theme = useTheme();
  if (error === null || error === undefined) {
    return null;
  }
  const requestId = error instanceof ApiError ? error.requestId : null;
  return (
    <View style={{ marginBottom: theme.spacing['4'] }}>
      <Text
        tone="danger"
        accessibilityRole="alert"
        accessibilityLiveRegion="polite"
        testID="form-error"
      >
        {errorMessage(i18n, error)}
      </Text>
      {requestId === null ? null : (
        <Text variant="caption" tone="muted" selectable style={{ marginTop: theme.spacing['1'] }}>
          {`${t('state.reference')}: ${requestId}`}
        </Text>
      )}
    </View>
  );
}

/** Inline text link, at least 44 pt tall. */
export function TextLink({
  label,
  onPress,
  hint,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly hint?: string;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={{ minHeight: theme.minTouchTarget, justifyContent: 'center' }}
    >
      <Text tone="link" variant="label">
        {label}
      </Text>
    </Pressable>
  );
}

/** Translates a `validation.*` key produced by the form resolver; unknown values render empty. */
export function useValidationText(): (message: string | undefined) => string | null {
  const { t } = useTranslation('auth');
  return (message) =>
    message === undefined || message === '' ? null : t(message, VALIDATION_PARAMS);
}

/** Password input with a show / hide switch that is announced with its state. */
export function PasswordField({
  showLabel,
  hideLabel,
  ...fieldProps
}: TextFieldProps & { readonly showLabel: string; readonly hideLabel: string }) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);
  return (
    <View>
      <TextField
        {...fieldProps}
        secureTextEntry={!visible}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable
        accessibilityRole="switch"
        accessibilityLabel={visible ? hideLabel : showLabel}
        accessibilityState={{ checked: visible }}
        onPress={() => setVisible((current) => !current)}
        style={{
          minHeight: theme.minTouchTarget,
          justifyContent: 'center',
          alignSelf: 'flex-start',
          marginTop: -theme.spacing['2'],
          marginBottom: theme.spacing['2'],
        }}
      >
        <Text tone="link" variant="footnote">
          {visible ? hideLabel : showLabel}
        </Text>
      </Pressable>
    </View>
  );
}

/**
 * "Continue with Apple / Google". A provider that cannot run on this device (no secure random
 * source, no client configuration, not iOS) is not shown at all.
 */
export function ProviderButtons({
  providers,
  disabled = false,
}: {
  readonly providers: ProviderSignIn;
  readonly disabled?: boolean;
}) {
  const { t } = useTranslation('auth');
  const theme = useTheme();
  const action = useAsyncAction();
  const [appleReady, setAppleReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const googleReady = providers.googleAvailable();

  useEffect(() => {
    let current = true;
    providers
      .appleAvailable()
      .then((available) => {
        if (current) {
          setAppleReady(available && Platform.OS === 'ios');
        }
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [providers]);

  if (!appleReady && !googleReady) {
    return null;
  }

  const start = (signIn: () => Promise<ProviderOutcome>): void => {
    setUnavailable(false);
    void action.run(async () => {
      if ((await signIn()) === 'unavailable') {
        setUnavailable(true);
      }
    });
  };

  return (
    <View style={{ marginTop: theme.spacing['4'] }}>
      <Text
        variant="footnote"
        tone="muted"
        align="center"
        style={{ marginBottom: theme.spacing['3'] }}
      >
        {t('provider.or')}
      </Text>
      <FormError error={action.error} />
      {unavailable ? (
        <Text
          tone="danger"
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={{ marginBottom: theme.spacing['4'] }}
        >
          {t('provider.unavailable')}
        </Text>
      ) : null}
      {appleReady ? (
        <Button
          label={t('provider.apple')}
          accessibilityHint={t('provider.appleHint')}
          variant="secondary"
          disabled={disabled}
          loading={action.busy}
          onPress={() => start(() => providers.signInWithApple())}
          testID="apple-sign-in"
          style={{ marginBottom: theme.spacing['3'] }}
        />
      ) : null}
      {googleReady ? (
        <Button
          label={t('provider.google')}
          accessibilityHint={t('provider.googleHint')}
          variant="secondary"
          disabled={disabled}
          loading={action.busy}
          onPress={() => start(() => providers.signInWithGoogle())}
          testID="google-sign-in"
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
