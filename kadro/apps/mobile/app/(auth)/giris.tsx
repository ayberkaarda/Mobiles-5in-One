import { useRouter } from 'expo-router';
import { useRef } from 'react';
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
import { currentPasswordIssue, emailIssue } from '../../src/auth/validation';
import { useTheme } from '../../src/theme';
import { Button, Text, TextField } from '../../src/ui';

interface SignInValues {
  email: string;
  password: string;
}

/** Email and password sign-in. A success flips the session; the root stack then opens the tabs. */
export default function SignInScreen() {
  const { t } = useTranslation('auth');
  const theme = useTheme();
  const router = useRouter();
  const action = useAsyncAction();
  const validationText = useValidationText();
  const passwordRef = useRef<TextInput>(null);
  const { control, handleSubmit } = useForm<SignInValues>({
    defaultValues: { email: '', password: '' },
    resolver: issueResolver<SignInValues>((values) => ({
      email: emailIssue(values.email),
      password: currentPasswordIssue(values.password),
    })),
  });

  const submit = handleSubmit((values) => {
    void action.run(() => authApi.login(values));
  });

  return (
    <AuthScreen title={t('signIn.title')} subtitle={t('signIn.subtitle')} testID="sign-in-screen">
      <FormError error={action.error} />
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <TextField
            label={t('signIn.email')}
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
            label={t('signIn.password')}
            showLabel={t('field.showPassword')}
            hideLabel={t('field.hidePassword')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={validationText(fieldState.error?.message)}
            editable={!action.busy}
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void submit()}
          />
        )}
      />
      <Button
        label={t('signIn.submit')}
        loading={action.busy}
        onPress={() => void submit()}
        testID="sign-in-submit"
      />
      <View style={{ marginTop: theme.spacing['2'] }}>
        <TextLink label={t('signIn.forgot')} onPress={() => router.push('/sifremi-unuttum')} />
      </View>
      <ProviderButtons providers={providerSignIn} action={action} />
      <Text variant="footnote" tone="muted" style={{ marginTop: theme.spacing['4'] }}>
        {t('signIn.deletionNote')}
      </Text>
      <View style={{ marginTop: theme.spacing['5'] }}>
        <Text tone="muted">{t('signIn.noAccount')}</Text>
        <TextLink label={t('signIn.signUpLink')} onPress={() => router.replace('/kayit')} />
      </View>
    </AuthScreen>
  );
}
