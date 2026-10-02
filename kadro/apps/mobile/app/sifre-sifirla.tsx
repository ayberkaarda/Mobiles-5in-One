import { useLinkingURL } from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import { ApiError } from '../src/api/errors';
import { session } from '../src/api/instance';
import { useAuthStatus } from '../src/auth-store';
import { AuthScreen, FormError, PasswordField, useValidationText } from '../src/auth/components';
import { issueResolver } from '../src/auth/forms';
import { authApi } from '../src/auth/instance';
import { tokenFromLink } from '../src/auth/link-token';
import { useAsyncAction } from '../src/auth/use-async-action';
import { newPasswordIssue, VALIDATION_PARAMS } from '../src/auth/validation';
import { useTheme } from '../src/theme';
import { Button, Text } from '../src/ui';

const LINK_PATH = 'sifre-sifirla';

interface ResetValues {
  password: string;
}

function InvalidLink() {
  const { t } = useTranslation('auth');
  const theme = useTheme();
  const router = useRouter();
  const status = useAuthStatus();
  // The forgot-password route belongs to the signed-out side of the router guard, so a signed-in
  // user is signed out on this device first; otherwise the navigation would land in the tabs.
  const requestNew = (): void => {
    void (status === 'signedIn' ? session.signOut() : Promise.resolve()).finally(() =>
      router.replace('/sifremi-unuttum'),
    );
  };
  return (
    <AuthScreen title={t('reset.invalidTitle')} testID="reset-invalid">
      <Text accessibilityRole="alert" style={{ marginBottom: theme.spacing['5'] }}>
        {t('reset.invalidMessage')}
      </Text>
      <Button label={t('reset.requestNew')} onPress={requestNew} />
    </AuthScreen>
  );
}

function ResetFlow({ token }: { readonly token: string }) {
  const { t } = useTranslation('auth');
  const theme = useTheme();
  const router = useRouter();
  const status = useAuthStatus();
  const action = useAsyncAction();
  const validationText = useValidationText();
  const [done, setDone] = useState(false);
  const { control, handleSubmit } = useForm<ResetValues>({
    defaultValues: { password: '' },
    resolver: issueResolver<ResetValues>((values) => ({
      password: newPasswordIssue(values.password),
    })),
  });

  const submit = handleSubmit((values) => {
    void action.run(async () => {
      await authApi.resetPassword({ token, password: values.password });
      if (status === 'signedIn') {
        // The server revoked every session of the account, this device's included. Signed out
        // before "done" is shown, so a quick tap on "Sign in" cannot land in the tabs.
        await session.signOut({ revokeRemote: false, reason: 'expired' });
      }
      setDone(true);
    });
  });

  // The token is single use: a rejected one means a new link is needed, not another attempt.
  if (action.error instanceof ApiError && action.error.code === 'token_invalid') {
    return <InvalidLink />;
  }

  if (done) {
    return (
      <AuthScreen title={t('reset.doneTitle')} testID="reset-done">
        <Text accessibilityLiveRegion="polite" style={{ marginBottom: theme.spacing['5'] }}>
          {t('reset.doneMessage')}
        </Text>
        <Button label={t('reset.toSignIn')} onPress={() => router.replace('/giris')} />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen title={t('reset.title')} subtitle={t('reset.subtitle')} testID="reset-screen">
      <FormError error={action.error} />
      <Controller
        control={control}
        name="password"
        render={({ field, fieldState }) => (
          <PasswordField
            label={t('reset.password')}
            helperText={t('reset.passwordHint', VALIDATION_PARAMS)}
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
        label={t('reset.submit')}
        loading={action.busy}
        onPress={() => void submit()}
        testID="reset-submit"
      />
    </AuthScreen>
  );
}

/**
 * Password reset from an email link (`https://.../sifre-sifirla#token=...` or
 * `kadro://sifre-sifirla?token=...`). Open in every session state: the server revokes all sessions
 * on success, so a signed-in user is signed out locally afterwards. The token is held in memory
 * only; a missing or malformed one shows the "link invalid" state without calling the API.
 */
export default function ResetPasswordScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const url = useLinkingURL();
  const incoming = tokenFromLink(LINK_PATH, url, params.token);
  const [held, setHeld] = useState<string | null>(incoming);

  // A newer link opened while the screen is up replaces the held token and restarts the flow.
  if (incoming !== null && incoming !== held) {
    setHeld(incoming);
  }

  return held === null ? <InvalidLink /> : <ResetFlow key={held} token={held} />;
}
