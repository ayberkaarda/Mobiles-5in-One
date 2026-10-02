import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { AuthScreen, FormError, TextLink, useValidationText } from '../../src/auth/components';
import { issueResolver } from '../../src/auth/forms';
import { authApi } from '../../src/auth/instance';
import { useAsyncAction } from '../../src/auth/use-async-action';
import { emailIssue } from '../../src/auth/validation';
import { useTheme } from '../../src/theme';
import { Button, Text, TextField } from '../../src/ui';

interface ForgotValues {
  email: string;
}

/**
 * Asks for a reset email. The answer is the same whether or not an account exists (ADR-0015), and
 * so is the confirmation shown here.
 */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation('auth');
  const theme = useTheme();
  const router = useRouter();
  const action = useAsyncAction();
  const validationText = useValidationText();
  const [done, setDone] = useState(false);
  const { control, handleSubmit } = useForm<ForgotValues>({
    defaultValues: { email: '' },
    resolver: issueResolver<ForgotValues>((values) => ({ email: emailIssue(values.email) })),
  });

  const submit = handleSubmit((values) => {
    void action.run(async () => {
      await authApi.forgotPassword(values.email);
      setDone(true);
    });
  });

  const back = (): void => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/giris');
    }
  };

  if (done) {
    return (
      <AuthScreen title={t('forgot.doneTitle')} testID="forgot-done">
        <Text accessibilityLiveRegion="polite" style={{ marginBottom: theme.spacing['5'] }}>
          {t('forgot.doneMessage')}
        </Text>
        <Button label={t('forgot.back')} variant="secondary" onPress={back} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={t('forgot.title')} subtitle={t('forgot.subtitle')} testID="forgot-screen">
      <FormError error={action.error} />
      <Controller
        control={control}
        name="email"
        render={({ field, fieldState }) => (
          <TextField
            label={t('forgot.email')}
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
            returnKeyType="send"
            onSubmitEditing={() => void submit()}
          />
        )}
      />
      <Button
        label={t('forgot.submit')}
        loading={action.busy}
        onPress={() => void submit()}
        testID="forgot-submit"
      />
      <TextLink label={t('forgot.back')} onPress={back} />
    </AuthScreen>
  );
}
