import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { type TextInput, View } from 'react-native';

import {
  AuthScreen,
  FormError,
  PasswordField,
  ProviderButtons,
  TextLink,
  useValidationText,
} from '../../src/auth/components';
import { issueResolver } from '../../src/auth/forms';
import { authApi, providerSignIn } from '../../src/auth/instance';
import { useAsyncAction } from '../../src/auth/use-async-action';
import {
  displayNameIssue,
  emailIssue,
  newPasswordIssue,
  VALIDATION_PARAMS,
} from '../../src/auth/validation';
import { useTheme } from '../../src/theme';
import { Button, Text, TextField } from '../../src/ui';

interface SignUpValues {
  displayName: string;
  email: string;
  password: string;
}

/**
 * Registration. The API answers 202 whether or not the address is taken (ADR-0015) and issues no
 * session, so the screen can only say "check your email" and send the user on to sign-in.
 */
export default function SignUpScreen() {
  const { t } = useTranslation('auth');
  const theme = useTheme();
  const router = useRouter();
  const action = useAsyncAction();
  const validationText = useValidationText();
  const [done, setDone] = useState(false);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const { control, handleSubmit } = useForm<SignUpValues>({
    defaultValues: { displayName: '', email: '', password: '' },
    resolver: issueResolver<SignUpValues>((values) => ({
      displayName: displayNameIssue(values.displayName),
      email: emailIssue(values.email),
      password: newPasswordIssue(values.password),
    })),
  });

  const submit = handleSubmit((values) => {
    void action.run(async () => {
      await authApi.register(values);
      setDone(true);
    });
  });

  if (done) {
    return (
      <AuthScreen title={t('signUp.doneTitle')} testID="sign-up-done">
        <Text accessibilityLiveRegion="polite" style={{ marginBottom: theme.spacing['5'] }}>
          {t('signUp.doneMessage')}
        </Text>
        <Button label={t('signUp.doneAction')} onPress={() => router.replace('/giris')} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={t('signUp.title')} subtitle={t('signUp.subtitle')} testID="sign-up-screen">
      <FormError error={action.error} />
      <Controller
        control={control}
        name="displayName"
        render={({ field, fieldState }) => (
          <TextField
            label={t('signUp.displayName')}
            helperText={t('signUp.displayNameHint')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validationText(fieldState.error?.message)}
            editable={!action.busy}
            autoComplete="name"
            textContentType="name"
            returnKeyType="next"
            onSubmitEditing={() => emailRef.current?.focus()}
          />
        )}
      />
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <TextField
            ref={emailRef}
            label={t('signUp.email')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validationText(fieldState.error?.message)}
            editable={!action.busy}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
            onSubmitEditing={() => passwordRef.current?.focus()}
          />
        )}
      />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <PasswordField
            ref={passwordRef}
            label={t('signUp.password')}
            helperText={t('signUp.passwordHint', VALIDATION_PARAMS)}
            showLabel={t('field.showPassword')}
            hideLabel={t('field.hidePassword')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validationText(fieldState.error?.message)}
            editable={!action.busy}
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
        )}
      />
      <Button
        label={t('signUp.submit')}
        loading={action.busy}
        onPress={() => void submit()}
        testID="sign-up-submit"
      />
      <ProviderButtons providers={providerSignIn} disabled={action.busy} />
      <View style={{ marginTop: theme.spacing['5'] }}>
        <Text tone="muted">{t('signUp.haveAccount')}</Text>
        <TextLink label={t('signUp.signInLink')} onPress={() => router.replace('/giris')} />
      </View>
    </AuthScreen>
  );
}
