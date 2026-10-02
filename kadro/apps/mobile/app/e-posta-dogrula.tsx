import { useQueryClient } from '@tanstack/react-query';
import { useLinkingURL } from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, View } from 'react-native';

import { ApiError } from '../src/api/errors';
import { useAuthStatus } from '../src/auth-store';
import { AuthScreen, FormError } from '../src/auth/components';
import { authApi } from '../src/auth/instance';
import { tokenFromLink } from '../src/auth/link-token';
import { useAsyncAction } from '../src/auth/use-async-action';
import { queryKeys } from '../src/query/keys';
import { useTheme } from '../src/theme';
import { Button, Text } from '../src/ui';

const LINK_PATH = 'e-posta-dogrula';

type VerifyState = 'verifying' | 'done' | 'invalid' | 'failed';

function Outcome({ state, error }: { readonly state: VerifyState; readonly error: unknown }) {
  const { t } = useTranslation('auth');
  const theme = useTheme();
  const router = useRouter();
  const status = useAuthStatus();
  const signedIn = status === 'signedIn';
  const continueTo = (): void => router.replace(signedIn ? '/maclar' : '/giris');

  if (state === 'verifying') {
    return (
      <AuthScreen title={t('verify.title')} testID="verify-pending">
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t('verify.verifying')}
          accessibilityState={{ busy: true }}
          style={{ alignItems: 'center', padding: theme.spacing['6'] }}
        >
          <ActivityIndicator />
          <Text tone="muted" style={{ marginTop: theme.spacing['3'] }}>
            {t('verify.verifying')}
          </Text>
        </View>
      </AuthScreen>
    );
  }
  if (state === 'invalid') {
    return (
      <AuthScreen title={t('verify.invalidTitle')} testID="verify-invalid">
        <Text accessibilityRole="alert" style={{ marginBottom: theme.spacing['5'] }}>
          {t('verify.invalidMessage')}
        </Text>
        <Button
          label={signedIn ? t('verify.continueSignedIn') : t('verify.continueSignedOut')}
          variant="secondary"
          onPress={continueTo}
        />
      </AuthScreen>
    );
  }
  if (state === 'failed') {
    return (
      <AuthScreen title={t('verify.failedTitle')} testID="verify-failed">
        <FormError error={error} />
        <Button
          label={signedIn ? t('verify.continueSignedIn') : t('verify.continueSignedOut')}
          variant="secondary"
          onPress={continueTo}
        />
      </AuthScreen>
    );
  }
  return (
    <AuthScreen title={t('verify.doneTitle')} testID="verify-done">
      <Text accessibilityLiveRegion="polite" style={{ marginBottom: theme.spacing['5'] }}>
        {t('verify.doneMessage')}
      </Text>
      <Button
        label={signedIn ? t('verify.continueSignedIn') : t('verify.continueSignedOut')}
        onPress={continueTo}
      />
    </AuthScreen>
  );
}

function VerifyFlow({ token }: { readonly token: string }) {
  const queryClient = useQueryClient();
  const action = useAsyncAction();
  const started = useRef(false);
  const [state, setState] = useState<VerifyState>('verifying');

  // One request per mounted flow: the token is single use, so a re-render must not repeat it.
  useEffect(() => {
    if (started.current) {
      return;
    }
    started.current = true;
    void action
      .run(() => authApi.verifyEmail(token))
      .then((ok) => {
        if (ok) {
          setState('done');
          // A signed-in user's cached profile still says "unverified".
          void queryClient.invalidateQueries({ queryKey: queryKeys.me() });
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per token (the flow is keyed by it)
  }, []);

  const error = action.error;
  if (error !== null) {
    const rejected = error instanceof ApiError && error.code === 'token_invalid';
    return <Outcome state={rejected ? 'invalid' : 'failed'} error={error} />;
  }
  return <Outcome state={state} error={null} />;
}

/**
 * Email verification from a link (`https://.../e-posta-dogrula#token=...` or
 * `kadro://e-posta-dogrula?token=...`). Open in every session state. The token is posted once and
 * kept in memory only; a missing or malformed one shows "link invalid" without calling the API.
 */
export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ token?: string }>();
  const url = useLinkingURL();
  const incoming = tokenFromLink(LINK_PATH, url, params.token);
  const [held, setHeld] = useState<string | null>(incoming);

  // A newer link opened while the screen is up replaces the held token and restarts the flow.
  if (incoming !== null && incoming !== held) {
    setHeld(incoming);
  }

  return held === null ? (
    <Outcome state="invalid" error={null} />
  ) : (
    <VerifyFlow key={held} token={held} />
  );
}
